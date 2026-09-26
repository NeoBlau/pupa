import { type Column, extendToBottom, sample, type Sample } from "../data/profile";
import { candidates, isNight, regionsFor, type Species } from "../data/species";
import { FORMULAS } from "../science/formulas";
import { euphoticDepth, irradianceSpectrum, lightZone, parFraction, waterColour, WAVELENGTHS } from "../science/optics";
import { ekman, piersonMoskowitz, synthesise, type WaveComponent } from "../science/waves";
import { sofarAxis } from "../science/teos10";
import { Submersible, type Environment } from "../sim/submersible";
import { DiveScene, displayBrightness } from "../render/scene";
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
}

interface CtdRecord { time: number; lat: number; lon: number; s: Sample; par: number }
interface LogEntry { time: number; depth: number; kind: "species" | "note" | "photo"; text: string; latin?: string; source?: string; t?: number; image?: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class DiveMode {
  private scene: DiveScene;
  private setup!: DiveSetup;
  private sub!: Submersible;
  private env!: Environment;
  private waves: WaveComponent[] = [];
  private warp = 10;
  private paused = false;
  private ctd: CtdRecord[] = [];
  private log: LogEntry[] = [];
  private lastRec = -Infinity;
  private lastDom = 0;
  private lastCharts = 0;
  private last = performance.now();
  private active = false;
  private hoverZ: number | null = null;
  private tsHover: { x: number; y: number } | null = null;
  private encounterTimer = 0;
  private profileCanvases: HTMLCanvasElement[] = [];
  private readonly thrustKeys = new Set<string>();

  constructor() {
    this.scene = new DiveScene($("view3d"));
    window.addEventListener("resize", () => this.scene.resize());
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

  start(setup: DiveSetup) {
    this.setup = setup;
    const column = extendToBottom(setup.column, setup.bottom);
    this.sub = Submersible.byId(setup.vehicleId, column.t[0]);
    const ek = ekman(setup.wind, setup.lat);
    const gulf = setup.missionId === "gulf_stream";
    this.waves = synthesise((w) => piersonMoskowitz(w, setup.wind * 1.026), 48, 0, 7);
    this.env = {
      column,
      bottom: setup.bottom,
      current: (z) => {
        let u = 0, v = 0;
        if (ek.valid) {
          const e = ek.at(z);
          u += e.speed * Math.cos(e.angleFromWind);
          v += e.speed * Math.sin(e.angleFromWind);
        }
        // Gulf Stream core ~1.5 m/s toward the NE, decaying over a few hundred m
        // (Talley et al. 2011, ch. 9) — mission-level representation.
        if (gulf) { const s = 1.5 * Math.exp(-z / 400); u += s * 0.8; v += s * 0.6; }
        return [u, v];
      },
      heave: (z, t) => {
        let w = 0;
        for (const c of this.waves) w += c.amp * c.omega * Math.exp(-c.k * z) * Math.sin(c.phase - c.omega * t);
        return w;
      },
    };
    this.ctd = [];
    this.log = [];
    this.lastRec = -Infinity;
    $<HTMLInputElement>("vb").value = String(this.sub.controls.vbFill);
    this.addLog({ kind: "note", text: `${setup.label} · ${L(this.sub.vehicle.name)} · ${setup.lat.toFixed(3)}, ${setup.lon.toFixed(3)}` });
    this.active = true;
    this.scene.resize();
    this.renderReadingsSkeleton();
    this.updateSource();
  }

  show() { this.scene.resize(); this.drawCharts(); }

  setWarp(w: number) { this.warp = w; }
  togglePause() { this.paused = !this.paused; return this.paused; }

  refreshLang() {
    if (!this.active) return;
    this.renderReadingsSkeleton();
    this.updateSource();
    this.renderLog();
    this.drawCharts();
  }

  private updateSource() {
    const src = this.env.column.source;
    $("data-src").textContent = src.startsWith("WOA23") ? `WOA23${src.includes("adiabatic") ? " + adiabatic extension" : ""}` : tr("idealised");
  }

  private bindControls() {
    const vb = $<HTMLInputElement>("vb");
    vb.addEventListener("input", () => { if (this.sub) this.sub.controls.vbFill = +vb.value; });
    $("drop").addEventListener("click", () => this.dropWeights());
    $("emerg").addEventListener("click", () => { this.sub?.emergencyAscent(); vb.value = "0"; this.addLog({ kind: "note", text: tr("emergency") }); });
    $("lights").addEventListener("click", () => this.toggleLights());
    $("photo").addEventListener("click", () => this.photo());
    $("exp-ctd").addEventListener("click", () => this.exportCTD());
    $("exp-log").addEventListener("click", () => this.exportLog());
    document.querySelectorAll<HTMLButtonElement>("[data-thr]").forEach((b) => {
      const [x, y] = b.dataset.thr!.split(",").map(Number);
      const on = () => { if (this.sub) { this.sub.controls.thrustX = x; this.sub.controls.thrustY = y; } };
      const off = () => { if (this.sub) { this.sub.controls.thrustX = 0; this.sub.controls.thrustY = 0; } };
      b.addEventListener("pointerdown", on);
      b.addEventListener("pointerup", off);
      b.addEventListener("pointerleave", off);
    });
    window.addEventListener("keydown", (e) => {
      if (!this.active || (e.target as HTMLElement).closest("input, select, textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "w" || k === "s") {
        const v = Math.min(1, Math.max(0, +vb.value + (k === "w" ? 0.05 : -0.05)));
        vb.value = String(v); this.sub.controls.vbFill = v;
      } else if (k === "b") this.dropWeights();
      else if (k === "l") this.toggleLights();
      else if (k === "p") this.photo();
      else if (e.key.startsWith("Arrow")) { this.thrustKeys.add(e.key); this.applyThrustKeys(); e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => { if (e.key.startsWith("Arrow")) { this.thrustKeys.delete(e.key); this.applyThrustKeys(); } });
  }

  private applyThrustKeys() {
    if (!this.sub) return;
    const k = this.thrustKeys;
    this.sub.controls.thrustX = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
    this.sub.controls.thrustY = (k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0);
  }

  private dropWeights() {
    if (!this.sub?.state.descentWeightsOn) return;
    this.sub.dropDescentWeights();
    this.addLog({ kind: "note", text: `${tr("dropWeights")}: ${this.sub.calibratedWeights.toFixed(0)} kg` });
  }

  private toggleLights() {
    if (!this.sub) return;
    this.sub.controls.lights = !this.sub.controls.lights;
    $("lights").setAttribute("aria-pressed", String(this.sub.controls.lights));
  }

  private photo() {
    if (!this.active) return;
    this.scene.render(this.viewState(), 0);
    this.addLog({ kind: "photo", text: tr("photo"), image: this.scene.snapshot() });
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dtReal = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    if (!this.active) return;
    const visible = !document.getElementById("mode-dive")!.hidden;
    if (!this.paused && !this.sub.state.imploded) {
      const simDt = dtReal * this.warp;
      this.sub.step(simDt, this.env);
      this.record();
      this.maybeEncounter(simDt);
    }
    if (!visible) return;
    this.scene.render(this.viewState(), this.paused ? 0 : dtReal);
    if (now - this.lastDom > 100) { this.lastDom = now; this.updateReadings(); }
    if (now - this.lastCharts > 500) { this.lastCharts = now; this.drawCharts(); }
  };

  private viewState() {
    const s = this.sub.state;
    const col = waterColour(s.z, this.setup.chl);
    const lum = col.luminance * this.dayFactor();
    const deep = s.z > 200;
    return {
      z: s.z, altitude: this.env.bottom - s.z, w: s.w, u: s.u, v: s.v, t: s.t,
      waterRGB: col.rgb, luminance: lum, lightsOn: this.sub.controls.lights,
      waves: this.waves, vents: this.setup.missionId === "tag_vents",
      bioRate: deep && s.z < 4000 ? 1.5 : deep ? 0.3 : 0.05,
    };
  }

  /** Local solar hour → surface light factor (0 at night, sin(elevation) by day). */
  private solarHour() {
    const startHour = 9; // dives start at 09:00 local solar time
    return (startHour + this.sub.state.t / 3600) % 24;
  }
  private dayFactor() {
    const h = this.solarHour();
    const el = Math.sin(((h - 6) / 12) * Math.PI);
    // Moon/starlight ≈ 1e-6 of daylight keeps night from being exactly zero.
    return Math.max(el, 1e-6);
  }

  private record() {
    const s = this.sub.state;
    const rec = Math.floor(s.z);
    if (Math.abs(rec - this.lastRec) < 1) return; // 1 m bins, like a CTD averaged to 1 dbar
    this.lastRec = rec;
    this.ctd.push({ time: s.t, lat: this.setup.lat, lon: this.setup.lon, s: sample(this.env.column, s.z), par: parFraction(s.z, this.setup.chl) * this.dayFactor() });
    if (this.ctd.length > 30000) this.ctd.splice(0, this.ctd.length - 30000);
  }

  private maybeEncounter(simDt: number) {
    this.encounterTimer -= simDt;
    const s = this.sub.state;
    const regions = regionsFor(this.setup.lat, this.setup.lon, this.setup.missionId);
    const fresh = this.setup.missionId === "baikal";
    const night = isNight(this.solarHour());
    const bright = displayBrightness(waterColour(s.z, this.setup.chl).luminance * this.dayFactor());
    for (const sp of candidates(s.z, regions, fresh, night, this.env.bottom - s.z)) {
      const canSee = this.sub.controls.lights || sp.bioluminescent || bright > 0.2;
      if (!canSee) continue;
      if (Math.random() < 1 - Math.exp(-(sp.rate * simDt) / 3600)) {
        if (this.encounterTimer > 0) continue;
        this.encounterTimer = 60; // at most one card per simulated minute
        this.showEncounter(sp);
      }
    }
  }

  private showEncounter(sp: Species) {
    this.scene.spawnCreature(sp.color, !!sp.bioluminescent, sp.id === "sperm_whale" ? 6 : sp.id === "amphipod" || sp.id === "epischura" || sp.id === "krill" ? 0.4 : 1.2);
    const s = this.sub.state;
    const smp = sample(this.env.column, s.z);
    this.addLog({ kind: "species", text: L(sp.name), latin: sp.latin, source: sp.source, t: smp.t });
    const card = $("encounter");
    card.hidden = false;
    card.innerHTML = `<small>${tr("encounter")} · ${s.z.toFixed(0)} m</small><b>${L(sp.name)}</b><i>${sp.latin}</i><p>${L(sp.fact)}</p><small>${sp.source}</small>`;
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
    const lat = () => this.setup.lat;
    const sub = () => this.sub;
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
      { key: "pelagicZone", label: tr("pelagicZone"), get: (s) => pelagicZone(s.z, this.env.bottom - s.z) },
      { key: "vspeed", label: tr("vspeed"), get: () => `${(-sub().state.w * 60).toFixed(1)} m/min` },
      { key: "netBuoy", label: tr("netBuoy"), f: "netBuoy", get: () => `${(sub().diagnose(sub().state, this.env).netDown / 9.81).toFixed(0)} kgf` },
      { key: "hullLoad", label: tr("hullLoad"), get: () => `${((sub().state.z / sub().vehicle.ratedDepth) * 100).toFixed(0)} %` },
      { key: "altitude", label: tr("altitude"), get: (s) => `${(this.env.bottom - s.z).toFixed(1)} m` },
      { key: "diveTime", label: tr("diveTime"), get: () => fmtTime(sub().state.t) },
    ];
    void lat;
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
    const smp = sample(this.env.column, s.z);
    for (const r of this.rows) $(`r-${r.key}`).textContent = r.get(smp);
    $("hud-depth").textContent = s.z.toFixed(1);
    $("vb-out").textContent = `${(this.sub.controls.vbFill * this.sub.vbMass).toFixed(0)} kg`;
    $("drop").toggleAttribute("disabled", !s.descentWeightsOn);
    $("hud-sub").textContent =
      `${L(this.sub.vehicle.name)} · ${this.setup.label}\n` +
      `${(-s.w).toFixed(2)} m/s · ${smp.t.toFixed(2)} °C · ${smp.p.toFixed(0)} dbar` +
      (s.landed ? `\n${tr("landed")}` : "");
    const alert = $("hud-alert");
    if (s.imploded) { alert.hidden = false; alert.textContent = tr("imploded"); }
    else if (s.z > this.sub.vehicle.ratedDepth) { alert.hidden = false; alert.textContent = tr("overRated"); }
    else alert.hidden = true;
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
    spec.forEach(([title, unit, fromS, fromCol], k) => {
      drawProfile(this.profileCanvases[k], {
        title, unit, maxZ, currentZ: this.sub.state.z, hoverZ: this.hoverZ,
        column: col.z.map((z, i) => [z, fromCol(i)] as [number, number]),
        trace: t.map((r) => [r.s.z, fromS(r.s)] as [number, number]),
      });
    });
    const tsCol = col.z.map((z, i) => ({ SA: col.SA[i], CT: col.CT[i], z }));
    const tsTrace = t.filter((_, i) => i % 5 === 0).map((r) => ({ SA: r.s.SA, CT: r.s.CT, z: r.s.z }));
    drawTS($("ts"), tsCol, tsTrace, maxZ, { x: "SA, g/kg", y: "Θ, °C" }, this.tsHover);
    const E = irradianceSpectrum(this.sub.state.z, this.setup.chl).map((v, i) => v / irradianceSpectrum(0, this.setup.chl)[i] * this.dayFactor());
    drawSpectrum($("spec"), WAVELENGTHS, E, `Ed(λ, ${this.sub.state.z.toFixed(0)} m) / Ed(λ, 0)`);
  }

  private exportCTD() {
    const col = this.env.column;
    const sofar = sofarAxis(col.p, col.z.map((z) => sample(col, z).soundSpeed));
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
