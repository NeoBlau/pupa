import * as THREE from "three";
import { type Column, extendToBottom, sample, type Sample } from "../data/profile";
import { candidates, isNight, regionsFor, type Species } from "../data/species";
import { FORMULAS } from "../science/formulas";
import { euphoticDepth, irradianceSpectrum, lightZone, parFraction, waterColour, WAVELENGTHS } from "../science/optics";
import { ekman, piersonMoskowitz, synthesise, type WaveComponent } from "../science/waves";
import { sofarAxis } from "../science/teos10";
import { Submersible, type Environment } from "../sim/submersible";
import { reliefFor, reliefHeight } from "../sim/terrain";
import { displayBrightness, solarElevation, World } from "../render/world";
import { Input, type Action } from "../input/input";
import { drawProfile, drawSpectrum, drawTS, hoverDepth } from "../ui/charts";
import { getLang, L, tr } from "../i18n";

export interface DiveSetup {
  lat: number;
  lon: number;
  bottom: number;
  chl: number;
  missionId?: string;
  vehicleId: string;
  column: Column;
  wind: number; // U10 m/s
  label: string;
  month?: number; // 0 = annual
}

interface CtdRecord { time: number; lat: number; lon: number; s: Sample; par: number }
interface LogEntry { time: number; depth: number; kind: "species" | "note" | "photo" | "scan"; text: string; latin?: string; source?: string; t?: number; image?: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MID_MONTH = [80, 15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const START_HOUR = 10; // dives start at 10:00 local solar time

export class DiveMode {
  readonly world: World;
  readonly input: Input;
  private setup!: DiveSetup;
  sub!: Submersible;
  private env!: Environment;
  private waves: WaveComponent[] = [];
  private warp = 10;
  private paused = false;
  private ctd: CtdRecord[] = [];
  private log: LogEntry[] = [];
  private lastRec = -Infinity;
  private lastDom = 0;
  private lastCharts = 0;
  private lastCockpit = 0;
  private last = performance.now();
  private active = false;
  private loading = false;
  private hoverZ: number | null = null;
  private tsHover: { x: number; y: number } | null = null;
  private encounterTimer = 0;
  private profileCanvases: HTMLCanvasElement[] = [];
  private touch = { surge: 0, yaw: 0 };
  private prevVel = { u: 0, v: 0, w: 0 };
  private criticalTimer = 0;
  private scanned = new Set<string>();
  /** Set by main.ts: forwards warp/pause actions to the top bar. */
  onGlobalAction: ((a: Action) => void) | null = null;

  constructor() {
    const canvas = $<HTMLCanvasElement>("view3d");
    this.world = new World(canvas);
    this.input = new Input(canvas);
    window.addEventListener("resize", () => this.world.resize());
    this.bindControls();
    const mult = $("multiples");
    for (let i = 0; i < 6; i++) {
      const c = document.createElement("canvas");
      c.addEventListener("mousemove", (e) => { this.hoverZ = hoverDepth(c, e, this.setup?.bottom ?? 1); this.drawCharts(); });
      c.addEventListener("mouseleave", () => { this.hoverZ = null; this.drawCharts(); });
      mult.appendChild(c);
      this.profileCanvases.push(c);
    }
    const ts = $<HTMLCanvasElement>("ts");
    ts.addEventListener("mousemove", (e) => { const r = ts.getBoundingClientRect(); this.tsHover = { x: e.clientX - r.left, y: e.clientY - r.top }; this.drawCharts(); });
    ts.addEventListener("mouseleave", () => { this.tsHover = null; this.drawCharts(); });
    requestAnimationFrame(this.frame);
  }

  get running() { return !this.paused; }
  get cameraMode() { return this.world.camMode; }

  async start(setup: DiveSetup) {
    this.setup = setup;
    this.active = false;
    this.loading = true;
    $("hud-loading").hidden = false;
    const column = extendToBottom(setup.column, setup.bottom);
    this.sub = Submersible.byId(setup.vehicleId, column.t[0]);
    const ek = ekman(setup.wind, setup.lat);
    const gulf = setup.missionId === "gulf_stream";
    this.waves = synthesise((w) => piersonMoskowitz(w, setup.wind * 1.026), 48, 0.4, 7);
    const relief = reliefFor(setup.missionId);
    const waves = this.waves;
    this.env = {
      column,
      bottom: setup.bottom,
      floor: (x, y) => setup.bottom - reliefHeight(x, y, relief),
      current: (z) => {
        let u = 0, v = 0;
        if (ek.valid) {
          const e = ek.at(z);
          u += e.speed * Math.cos(e.angleFromWind);
          v += e.speed * Math.sin(e.angleFromWind);
        }
        // Gulf Stream core ~1.5 m/s toward the NE, decaying over a few hundred m (Talley et al. 2011, ch. 9)
        if (gulf) { const s = 1.5 * Math.exp(-z / 400); u += s * 0.8; v += s * 0.6; }
        return [u, v];
      },
      heave: (z, t) => {
        let w = 0;
        for (const c of waves) w += c.amp * c.omega * Math.exp(-c.k * z) * Math.sin(c.phase - c.omega * t);
        return w;
      },
      eta: (x, y, t) => {
        let e = 0;
        for (const c of waves) e += c.amp * Math.cos(c.k * (x * Math.cos(c.dir) + y * Math.sin(c.dir)) - c.omega * t + c.phase);
        return e;
      },
    };
    this.ctd = [];
    this.log = [];
    this.scanned.clear();
    this.lastRec = -Infinity;
    this.world.track = [];
    const regions = regionsFor(setup.lat, setup.lon, setup.missionId);
    await this.world.setup({
      vehicleId: setup.vehicleId, missionId: setup.missionId, bottom: setup.bottom, relief, chl: setup.chl,
      waves: this.waves, lat: setup.lat, dayOfYear: MID_MONTH[setup.month ?? 0], regionTags: regions,
    }, this.sub);
    this.env.obstacles = this.world.physicsObstacles();
    // start afloat: descent weights on, soft tanks blown, ready to vent and dive
    this.sub.controls.mbtBlow = true;
    this.sub.state.mbtAir = 1;
    this.sub.state.z = -0.2;
    $<HTMLInputElement>("vb").value = String(this.sub.controls.vbFill);
    this.addLog({ kind: "note", text: `${setup.label} · ${L(this.sub.vehicle.name)} · ${setup.lat.toFixed(3)}, ${setup.lon.toFixed(3)}` });
    this.loading = false;
    this.active = true;
    $("hud-loading").hidden = true;
    this.world.resize();
    this.renderReadingsSkeleton();
    this.updateSource();
    this.syncButtons();
  }

  show() { this.world.resize(); this.drawCharts(); }

  setWarp(w: number) { this.warp = w; }
  togglePause() { this.paused = !this.paused; return this.paused; }

  refreshLang() {
    if (!this.active) return;
    this.renderReadingsSkeleton();
    this.updateSource();
    this.renderLog();
    this.drawCharts();
    this.syncButtons();
  }

  private updateSource() {
    const src = this.env.column.source;
    $("data-src").textContent = src.startsWith("WOA23") ? `WOA23${src.includes("adiabatic") ? " + adiabatic extension" : ""}` : tr("idealised");
  }

  private bindControls() {
    const vb = $<HTMLInputElement>("vb");
    vb.addEventListener("input", () => { if (this.sub) this.sub.controls.vbFill = +vb.value; });
    const btn: Array<[string, Action]> = [["drop", "drop"], ["emerg", "emergency"], ["lights", "lights"], ["photo", "photo"], ["cam-toggle", "camera"], ["hold", "depthHold"], ["tanks", "surfaceTanks"], ["scan", "interact"]];
    for (const [id, a] of btn) $(id).addEventListener("click", () => this.input.trigger(a));
    $("exp-ctd").addEventListener("click", () => this.exportCTD());
    $("exp-log").addEventListener("click", () => this.exportLog());
    document.querySelectorAll<HTMLButtonElement>("[data-thr]").forEach((b) => {
      const [x, y] = b.dataset.thr!.split(",").map(Number);
      const on = () => { this.touch.surge = y; this.touch.yaw = -x; };
      const off = () => { this.touch.surge = 0; this.touch.yaw = 0; };
      b.addEventListener("pointerdown", on);
      b.addEventListener("pointerup", off);
      b.addEventListener("pointerleave", off);
    });
  }

  private handle(a: Action) {
    const s = this.sub;
    switch (a) {
      case "camera": {
        const m = this.world.toggleCamera();
        this.flash(m === "first" ? tr("firstPerson") : tr("thirdPerson"));
        break;
      }
      case "lights": s.controls.lights = !s.controls.lights && s.powered; break;
      case "drop": {
        const kg = s.dropWeights();
        if (kg > 0) {
          this.addLog({ kind: "note", text: `${tr("dropWeights")}: ${kg.toFixed(0)} kg` });
          this.input.rumble(0.6, 0.3, 250);
        }
        break;
      }
      case "emergency":
        s.emergencyAscent();
        $<HTMLInputElement>("vb").value = "0";
        this.addLog({ kind: "note", text: tr("emergency") });
        this.input.rumble(1, 1, 600);
        break;
      case "photo": this.photo(); break;
      case "depthHold":
        if (!s.controls.depthHold && !s.canHold) { this.flash(tr("holdNeedsDrop")); break; }
        this.flash(s.toggleDepthHold() ? `${tr("depthHold")}: ${s.controls.holdDepth.toFixed(0)} m` : `${tr("depthHold")}: ${tr("off")}`);
        break;
      case "surfaceTanks":
        if (s.controls.mbtBlow) { s.dive(); $<HTMLInputElement>("vb").value = "1"; this.flash(tr("vent")); }
        else { s.controls.mbtBlow = true; this.flash(tr("blow")); }
        break;
      case "interact": this.scan(); break;
      default: this.onGlobalAction?.(a);
    }
    this.syncButtons();
  }

  private syncButtons() {
    if (!this.sub) return;
    $("lights").setAttribute("aria-pressed", String(this.sub.controls.lights));
    $("hold").setAttribute("aria-pressed", String(this.sub.controls.depthHold));
    $("tanks").textContent = this.sub.controls.mbtBlow ? tr("vent") : tr("blow");
    $("cam-toggle").textContent = this.world.camMode === "first" ? tr("thirdPerson") : tr("firstPerson");
  }

  private flash(text: string) {
    const el = $("hud-flash");
    el.textContent = text;
    el.hidden = false;
    clearTimeout((el as unknown as { _t?: number })._t);
    (el as unknown as { _t?: number })._t = window.setTimeout(() => (el.hidden = true), 1800);
  }

  private scan() {
    const r = this.world.model.root;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(r.quaternion);
    const sp = this.world.ecosystem.scan({ pos: r.position.clone(), vel: new THREE.Vector3(), forward: fwd, lightsOn: this.sub.controls.lights, noise: 0 });
    this.world.armAction();
    if (!sp) { this.flash(tr("scanNone")); return; }
    const first = !this.scanned.has(sp.id);
    this.scanned.add(sp.id);
    const smp = sample(this.env.column, Math.max(this.sub.state.z, 0));
    this.addLog({ kind: "scan", text: `${L(sp.name)}${sp.kind === "procedural" ? " ◇" : ""}`, latin: sp.latin, source: sp.source, t: smp.t });
    this.showCard(`${tr("scanned")} · ${this.sub.state.z.toFixed(0)} m${first ? "" : " ↺"}`, L(sp.name), sp.latin, L(sp.fact), sp.source + (sp.kind === "procedural" ? ` · ${tr("proceduralNote")}` : ""));
    this.input.rumble(0.1, 0.4, 120);
  }

  private photo() {
    if (!this.active) return;
    this.addLog({ kind: "photo", text: tr("photo"), image: this.world.snapshot() });
  }

  private applyInput(dtReal: number) {
    const c = this.input.cmd;
    const ctl = this.sub.controls;
    ctl.surge = Math.max(-1, Math.min(1, c.surge + this.touch.surge));
    ctl.yaw = Math.max(-1, Math.min(1, c.yaw + this.touch.yaw));
    ctl.sway = c.sway;
    if (c.heave !== 0) {
      if (ctl.depthHold) { ctl.depthHold = false; this.syncButtons(); }
      ctl.heave = c.heave;
    } else if (!ctl.depthHold) ctl.heave = 0;
    if (c.ballast !== 0) {
      ctl.vbFill = Math.max(0, Math.min(1, ctl.vbFill + c.ballast * 0.15 * dtReal));
      $<HTMLInputElement>("vb").value = String(ctl.vbFill);
    }
    this.world.lookInput(c.lookX, c.lookY, c.zoom);
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dtReal = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.active || this.loading) return;
    const visible = !document.getElementById("mode-dive")!.hidden;
    this.input.enabled = visible;
    if (visible) {
      this.input.update();
      for (const a of this.input.drainActions()) this.handle(a);
      this.applyInput(dtReal);
    }
    if (!this.paused && !this.sub.state.imploded) {
      const simDt = dtReal * this.warp;
      this.sub.step(simDt, this.env);
      this.record();
      this.maybeEncounter(simDt);
      this.events(dtReal);
    }
    if (!visible) return;
    this.world.frame(this.sub, this.paused ? 0 : dtReal, { t: this.sub.state.t, solarHour: this.solarHour(), lang: getLang(), warnings: this.warnings() });
    if (now - this.lastDom > 100) { this.lastDom = now; this.updateReadings(); }
    if (now - this.lastCharts > 500) { this.lastCharts = now; this.drawCharts(); }
    if (now - this.lastCockpit > 250) { this.lastCockpit = now; this.updateCockpit(); }
  };

  /** Subsystem events → log, HUD and gamepad rumble. */
  private events(dtReal: number) {
    const s = this.sub.state;
    for (const e of this.sub.drainEvents()) {
      switch (e.kind) {
        case "impact":
          this.input.rumble(Math.min(1, e.speed / 2), Math.min(1, e.speed), 200 + 200 * Math.min(1, e.speed));
          this.flash(`${tr("impact")} ${e.speed.toFixed(1)} m/s`);
          this.addLog({ kind: "note", text: `${tr("impact")} ${e.speed.toFixed(1)} m/s · ${tr("hull")} ${(s.hull * 100).toFixed(0)} %` });
          break;
        case "overdepth": this.input.rumble(0.8, 0.8, 500); this.addLog({ kind: "note", text: tr("overRated") }); break;
        case "lowBattery": this.input.rumble(0.3, 0.6, 300); this.addLog({ kind: "note", text: tr("lowBattery") }); break;
        case "batteryEmpty": this.input.rumble(1, 0.5, 700); this.addLog({ kind: "note", text: tr("batteryEmpty") }); break;
        case "surfaced": this.addLog({ kind: "note", text: tr("surfaced") }); this.syncButtons(); break;
        case "submerged": this.addLog({ kind: "note", text: tr("submerged") }); break;
        case "imploded": this.input.rumble(1, 1, 1500); this.addLog({ kind: "note", text: tr("imploded") }); break;
      }
    }
    // strong acceleration (e.g. weights dropped, full thrust)
    const dv = Math.hypot(s.u - this.prevVel.u, s.v - this.prevVel.v, s.w - this.prevVel.w) / Math.max(dtReal * this.warp, 1e-3);
    if (dv > 0.35) this.input.rumble(0, Math.min(1, dv / 2), 80);
    this.prevVel = { u: s.u, v: s.v, w: s.w };
    // critical: beyond rated depth → pulse every 2 s
    this.criticalTimer -= dtReal;
    if (s.z > this.sub.vehicle.ratedDepth && this.criticalTimer <= 0) { this.criticalTimer = 2; this.input.rumble(0.9, 0.2, 180); }
  }

  private warnings(): string[] {
    const s = this.sub.state, v = this.sub.vehicle, w: string[] = [];
    if (s.z > v.ratedDepth) w.push(tr("overRated"));
    if (s.battery < 0.1 * this.sub.batteryJ) w.push(tr("lowBattery"));
    if (s.hull < 0.7) w.push(`${tr("hull")} ${(s.hull * 100).toFixed(0)} %`);
    const alt = this.env.floor!(s.x, s.y) - s.z - v.height / 2;
    if (alt < 5 && Math.abs(s.w) > 0.4) w.push(tr("floorAhead"));
    if (s.imploded) w.push(tr("imploded"));
    return w;
  }

  private dayFactor() {
    const { elev } = solarElevation(this.setup.lat, MID_MONTH[this.setup.month ?? 0], this.solarHour());
    // Moon/starlight ≈ 1e-6 of daylight keeps night from being exactly zero.
    return Math.max(Math.sin(elev), 1e-6);
  }

  private solarHour() { return (START_HOUR + this.sub.state.t / 3600) % 24; }

  private record() {
    const s = this.sub.state;
    if (s.z < 0) return;
    const rec = Math.floor(s.z);
    if (Math.abs(rec - this.lastRec) < 1) return; // 1 m bins, like a CTD averaged to 1 dbar
    this.lastRec = rec;
    this.ctd.push({ time: s.t, lat: this.setup.lat, lon: this.setup.lon, s: sample(this.env.column, s.z), par: parFraction(s.z, this.setup.chl) * this.dayFactor() });
    if (this.ctd.length > 30000) this.ctd.splice(0, this.ctd.length - 30000);
  }

  /** Organisms without a 3D model appear as encounter cards (literature depth ranges). */
  private maybeEncounter(simDt: number) {
    this.encounterTimer -= simDt;
    const s = this.sub.state;
    if (s.z < 1) return;
    const regions = regionsFor(this.setup.lat, this.setup.lon, this.setup.missionId);
    const fresh = this.setup.missionId === "baikal";
    const night = isNight(this.solarHour());
    const bright = displayBrightness(waterColour(s.z, this.setup.chl).luminance * this.dayFactor());
    for (const sp of candidates(s.z, regions, fresh, night, this.env.floor!(s.x, s.y) - s.z)) {
      const canSee = this.sub.controls.lights || sp.bioluminescent || bright > 0.2;
      if (!canSee) continue;
      if (Math.random() < 1 - Math.exp(-(sp.rate * simDt) / 3600)) {
        if (this.encounterTimer > 0) continue;
        this.encounterTimer = 60;
        this.showEncounter(sp);
      }
    }
  }

  private showEncounter(sp: Species) {
    const s = this.sub.state;
    const smp = sample(this.env.column, s.z);
    this.addLog({ kind: "species", text: L(sp.name), latin: sp.latin, source: sp.source, t: smp.t });
    this.showCard(`${tr("encounter")} · ${s.z.toFixed(0)} m`, L(sp.name), sp.latin, L(sp.fact), sp.source);
  }

  private showCard(head: string, name: string, latin: string, fact: string, source: string) {
    const card = $("encounter");
    card.hidden = false;
    card.innerHTML = "";
    const add = (tag: string, text: string) => { const e = document.createElement(tag); e.textContent = text; card.appendChild(e); };
    add("small", head); add("b", name); add("i", latin); add("p", fact); add("small", source);
    clearTimeout((card as unknown as { _t?: number })._t);
    (card as unknown as { _t?: number })._t = window.setTimeout(() => (card.hidden = true), 9000);
  }

  private addLog(e: Omit<LogEntry, "time" | "depth">) {
    this.log.push({ ...e, time: this.sub?.state.t ?? 0, depth: this.sub?.state.z ?? 0 });
    this.renderLog();
  }

  private renderLog() {
    const ol = $("log");
    ol.innerHTML = "";
    for (const e of [...this.log].reverse()) {
      const li = document.createElement("li");
      const hdr = `${fmtTime(e.time)} · ${e.depth.toFixed(0)} m`;
      li.textContent = `${hdr} — ${e.text}${e.latin ? ` (${e.latin})` : ""}${e.t != null ? ` · t=${e.t.toFixed(2)} °C` : ""}`;
      if (e.image) { const img = document.createElement("img"); img.src = e.image; img.alt = hdr; li.appendChild(img); }
      ol.appendChild(li);
    }
  }

  private rows: Array<{ key: string; label: string; f?: string; get: (s: Sample) => string }> = [];

  private renderReadingsSkeleton() {
    const sub = () => this.sub;
    const alt = () => this.env.floor!(sub().state.x, sub().state.y) - sub().state.z - sub().vehicle.height / 2;
    this.rows = [
      { key: "pressure", label: tr("pressure"), f: "pressure", get: (s) => `${s.p.toFixed(1)} dbar · ${(s.p / 100).toFixed(2)} MPa` },
      { key: "insituT", label: tr("insituT"), f: "insituT", get: (s) => `${s.t.toFixed(3)} °C` },
      { key: "CT", label: tr("CT"), f: "CT", get: (s) => `${s.CT.toFixed(3)} °C` },
      { key: "SP", label: tr("SP"), f: "SP", get: (s) => s.SP.toFixed(3) },
      { key: "SA", label: tr("SA"), f: "SA", get: (s) => `${s.SA.toFixed(3)} g/kg` },
      { key: "rho", label: tr("rho"), f: "rho", get: (s) => `${s.rho.toFixed(3)} kg/m³` },
      { key: "sigma0", label: tr("sigma0"), f: "sigma0", get: (s) => `${s.sigma0.toFixed(3)} kg/m³` },
      { key: "soundSpeed", label: tr("soundSpeed"), f: "soundSpeed", get: (s) => `${s.soundSpeed.toFixed(2)} m/s` },
      { key: "soundMack", label: tr("soundMack"), f: "soundMack", get: (s) => (s.z <= 8000 && s.t >= 2 ? `${s.soundSpeedMackenzie.toFixed(2)} m/s` : "— (out of validity)") },
      { key: "N2", label: tr("N2"), f: "N2", get: (s) => `${s.N2.toExponential(2)} s⁻²` },
      { key: "O2", label: tr("O2"), f: "O2", get: (s) => `${s.O2.toFixed(0)} µmol/kg` },
      { key: "NO3", label: tr("NO3"), get: (s) => `${s.NO3.toFixed(1)} µmol/kg` },
      { key: "light", label: tr("light"), f: "light", get: (s) => (parFraction(s.z, this.setup.chl) * this.dayFactor()).toExponential(2) },
      { key: "lightZone", label: tr("lightZone"), get: (s) => tr(lightZone(s.z, this.setup.chl)) },
      { key: "pelagicZone", label: tr("pelagicZone"), get: (s) => pelagicZone(s.z, alt()) },
      { key: "speed", label: tr("speedH"), get: () => `${Math.hypot(sub().state.u, sub().state.v).toFixed(2)} m/s · ${tr("heading")} ${Math.round(((90 - (sub().state.heading * 180) / Math.PI) % 360 + 360) % 360)}°` },
      { key: "vspeed", label: tr("vspeed"), get: () => `${(-sub().state.w * 60).toFixed(1)} m/min` },
      { key: "netBuoy", label: tr("netBuoy"), f: "netBuoy", get: () => `${(sub().diagnose(sub().state, this.env).netDown / 9.81).toFixed(0)} kgf` },
      { key: "battery", label: tr("battery"), get: () => `${((sub().state.battery / sub().batteryJ) * 100).toFixed(1)} % · ${(sub().state.battery / 3.6e6).toFixed(1)} kWh` },
      { key: "hullLoad", label: tr("hullLoad"), get: () => `${((Math.max(sub().state.z, 0) / sub().vehicle.ratedDepth) * 100).toFixed(0)} % · ${tr("hull")} ${(sub().state.hull * 100).toFixed(0)} %` },
      { key: "altitude", label: tr("altitude"), get: () => `${alt().toFixed(1)} m` },
      { key: "diveTime", label: tr("diveTime"), get: () => fmtTime(sub().state.t) },
    ];
    const tb = $<HTMLTableElement>("readings");
    tb.innerHTML = "";
    for (const r of this.rows) {
      const tr_ = document.createElement("tr");
      if (r.f) {
        tr_.className = "clickable";
        tr_.title = tr("formula");
        tr_.addEventListener("click", () => openFormula(r.label, r.f!));
      }
      tr_.innerHTML = `<td>${r.label}${r.f ? '<span class="f">ƒ</span>' : ""}</td><td id="r-${r.key}"></td>`;
      tb.appendChild(tr_);
    }
  }

  private updateReadings() {
    const s = this.sub.state;
    const smp = sample(this.env.column, Math.max(s.z, 0));
    for (const r of this.rows) $(`r-${r.key}`).textContent = r.get(smp);
    $("hud-depth").textContent = s.z.toFixed(1);
    $("vb-out").textContent = `${s.vbMass.toFixed(0)} / ${(this.sub.controls.vbFill * this.sub.vbMass).toFixed(0)} kg`;
    $("drop").toggleAttribute("disabled", !s.ascentWeightsOn);
    const status = s.submerged < 0.98 ? tr("afloat") : s.landed ? tr("landed") : this.sub.controls.depthHold ? `HOLD ${this.sub.controls.holdDepth.toFixed(0)} m` : "";
    $("hud-sub").textContent =
      `${L(this.sub.vehicle.name)} · ${this.setup.label}\n` +
      `${(-s.w).toFixed(2)} m/s ↕ · ${Math.hypot(s.u, s.v).toFixed(2)} m/s → · ${smp.t.toFixed(2)} °C · ${smp.p.toFixed(0)} dbar\n` +
      `${tr("battery")} ${((s.battery / this.sub.batteryJ) * 100).toFixed(0)} % · ${tr("hull")} ${(s.hull * 100).toFixed(0)} %` +
      (status ? `\n${status}` : "");
    const w = this.warnings();
    const alert = $("hud-alert");
    alert.hidden = w.length === 0;
    alert.textContent = w.join(" · ");
    $("hud-gamepad").textContent = this.input.gamepadName ? `🎮 ${this.input.gamepadName.slice(0, 40)}` : "";
  }

  private updateCockpit() {
    if (this.world.camMode !== "first") return;
    const s = this.sub.state, v = this.sub.vehicle;
    const smp = sample(this.env.column, Math.max(s.z, 0));
    const ctl = this.sub.controls;
    this.world.updateCockpit({
      lang: getLang(), depth: s.z, speed: Math.hypot(s.u, s.v), vspeed: s.w, heading: s.heading,
      pressure: smp.p, tIn: 18 + Math.min(4, s.t / 3600), tOut: smp.t, sound: smp.soundSpeed,
      battery: s.battery / this.sub.batteryJ, batteryKWh: s.battery / 3.6e6,
      power: (v.hotelLoad * 1000 + (ctl.lights ? v.lightsW : 0) + ((Math.abs(ctl.surge) + Math.abs(ctl.sway) + Math.abs(ctl.heave)) / 3) * v.thrusterPower * 1000) / 1000,
      thrusters: { surge: ctl.surge, sway: ctl.sway, heave: ctl.heave, yaw: ctl.yaw },
      lights: ctl.lights, depthHold: ctl.depthHold, holdDepth: ctl.holdDepth,
      hull: s.hull, rated: v.ratedDepth, collapse: this.sub.collapseDepth,
      altitude: this.env.floor!(s.x, s.y) - s.z - v.height / 2,
      vb: s.vbMass, weights: `${(s.descentWeightsOn ? 1 : 0) + (s.ascentWeightsOn ? 1 : 0)}/2`,
      warnings: this.warnings(), vehicleName: L(v.name), time: START_HOUR * 3600 + s.t,
    }, s);
  }

  drawCharts() {
    if (!this.active) return;
    const col = this.env.column;
    const maxZ = this.env.bottom;
    const t = this.ctd;
    const spec: Array<[string, string, (s: Sample) => number, (i: number) => number]> = [
      ["t", "°C", (s) => s.t, (i) => col.t[i]],
      ["SA", "g/kg", (s) => s.SA, (i) => col.SA[i]],
      ["σ₀", "kg/m³", (s) => s.sigma0, (i) => col.sigma0[i]],
      ["c", "m/s", (s) => s.soundSpeed, (i) => sample(col, col.z[i]).soundSpeed],
      ["O₂", "µmol/kg", (s) => s.O2, (i) => col.O2[i]],
      ["N²", "s⁻²", (s) => s.N2, (i) => sample(col, col.z[i]).N2],
    ];
    const z = Math.max(this.sub.state.z, 0);
    spec.forEach(([title, unit, fromS, fromCol], k) => {
      drawProfile(this.profileCanvases[k], {
        title, unit, maxZ, currentZ: z, hoverZ: this.hoverZ,
        column: col.z.map((zz, i) => [zz, fromCol(i)] as [number, number]),
        trace: t.map((r) => [r.s.z, fromS(r.s)] as [number, number]),
      });
    });
    const tsCol = col.z.map((zz, i) => ({ SA: col.SA[i], CT: col.CT[i], z: zz }));
    const tsTrace = t.filter((_, i) => i % 5 === 0).map((r) => ({ SA: r.s.SA, CT: r.s.CT, z: r.s.z }));
    drawTS($("ts"), tsCol, tsTrace, maxZ, { x: "SA, g/kg", y: "Θ, °C" }, this.tsHover);
    const E0 = irradianceSpectrum(0, this.setup.chl);
    const E = irradianceSpectrum(z, this.setup.chl).map((v, i) => (v / E0[i]) * this.dayFactor());
    drawSpectrum($("spec"), WAVELENGTHS, E, `Ed(λ, ${z.toFixed(0)} m) / Ed(λ, 0)`);
  }

  private exportCTD() {
    const col = this.env.column;
    const sofar = sofarAxis(col.p, col.z.map((zz) => sample(col, zz).soundSpeed));
    const head = [
      `# Ocean simulator CTD export`,
      `# site: ${this.setup.label}; lat ${this.setup.lat}; lon ${this.setup.lon}; bottom ${this.setup.bottom} m`,
      `# vehicle: ${this.sub.vehicle.name.en}`,
      `# data source: ${col.source}${col.source.startsWith("idealised") ? " (NOT measurements)" : ""}`,
      `# equation of state: TEOS-10 (Roquet et al. 2015 75-term), verified against gsw`,
      `# surface chlorophyll-a ${this.setup.chl} mg/m3; euphotic depth ${euphoticDepth(this.setup.chl).toFixed(1)} m`,
      `# SOFAR axis (column): ${sofar.p.toFixed(0)} dbar, c = ${sofar.c.toFixed(2)} m/s`,
      "time_s,depth_m,pressure_dbar,t_insitu_C,CT_C,SP,SA_gkg,rho_kgm3,sigma0_kgm3,c_TEOS10_ms,c_Mackenzie_ms,N2_s2,O2_umolkg,NO3_umolkg,PAR_fraction",
    ];
    const rows = this.ctd.map(({ time, s, par }) =>
      [time.toFixed(1), s.z.toFixed(2), s.p.toFixed(2), s.t.toFixed(4), s.CT.toFixed(4), s.SP.toFixed(4), s.SA.toFixed(4), s.rho.toFixed(4), s.sigma0.toFixed(4), s.soundSpeed.toFixed(3), s.soundSpeedMackenzie.toFixed(3), s.N2.toExponential(4), s.O2.toFixed(2), s.NO3.toFixed(2), par.toExponential(4)].join(","),
    );
    download(`ctd_${this.setup.missionId ?? "free"}_${Date.now()}.csv`, [...head, ...rows].join("\n"), "text/csv");
  }

  private exportLog() {
    const data = {
      site: { label: this.setup.label, lat: this.setup.lat, lon: this.setup.lon, bottom: this.setup.bottom, mission: this.setup.missionId ?? null },
      vehicle: this.sub.vehicle.id, lang: getLang(), dataSource: this.env.column.source,
      entries: this.log,
    };
    download(`dive_log_${Date.now()}.json`, JSON.stringify(data, null, 2), "application/json");
  }
}

function pelagicZone(z: number, altitude: number): string {
  const ru = getLang() === "ru";
  if (z < 0.5) return ru ? "на поверхности" : "at the surface";
  if (altitude < 10) return ru ? "бенталь (придонная)" : "benthic";
  if (z < 200) return ru ? "эпипелагиаль" : "epipelagic";
  if (z < 1000) return ru ? "мезопелагиаль" : "mesopelagic";
  if (z < 4000) return ru ? "батипелагиаль" : "bathypelagic";
  if (z < 6000) return ru ? "абиссопелагиаль" : "abyssopelagic";
  return ru ? "хадопелагиаль" : "hadopelagic";
}

const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function openFormula(title: string, key: string) {
  const f = FORMULAS[key];
  if (!f) return;
  $("f-title").textContent = title;
  $("f-tex").textContent = f.tex;
  $("f-explain").textContent = L(f.explain);
  $("f-refs").innerHTML = f.refs.map((r) => `<li>${r}</li>`).join("");
  $<HTMLDialogElement>("formula").showModal();
}
