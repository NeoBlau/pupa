/**
 * Pressure-sphere interiors and live cockpit displays.
 *
 * The shell is the inside of the personnel sphere with the real viewport
 * openings cut out (triangles inside each viewport cone are removed). The
 * displays are canvas textures redrawn a few times per second from the
 * simulation state; camera feeds come from render targets of the hull cameras.
 */
import * as THREE from "three";
import type { VehicleModel } from "./models";
import { MAT, roundedBox } from "./parts";

export interface CockpitData {
  lang: "ru" | "en";
  depth: number; speed: number; vspeed: number; heading: number;
  pressure: number; tIn: number; tOut: number; sound: number;
  battery: number; batteryKWh: number; power: number;
  thrusters: { surge: number; sway: number; heave: number; yaw: number };
  lights: boolean; depthHold: boolean; holdDepth: number;
  hull: number; rated: number; collapse: number; altitude: number;
  vb: number; weights: string; warnings: string[];
  track: Array<[number, number]>; x: number; y: number;
  sonar: number[]; // echo strength per bearing bin (−60…60°), 0…1
  sonarRange: number;
  camFeeds: THREE.Texture[];
  vehicleName: string;
  time: number;
}

type Screen = { kind: string; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mesh: THREE.Mesh; w: number; h: number };

const CYAN = "#2ee6ff", AMBER = "#ffb000", RED = "#ff4d4d", GREEN = "#5dff9e", TXT = "#d8f4ff", DIM = "#6f8a99";

export class Cockpit {
  readonly group = new THREE.Group();
  private screens: Screen[] = [];
  private feedMeshes: THREE.Mesh[] = [];
  private style: "analog" | "classic" | "modern" | "future";
  private sweep = 0;

  constructor(private model: VehicleModel, vehicleId: string) {
    this.style = vehicleId === "trieste" ? "analog" : vehicleId === "nereid_x" ? "future" : vehicleId === "mir" ? "classic" : "modern";
    const cab = model.cabin;
    this.group.position.copy(cab.center);
    this.buildShell();
    this.buildInterior(vehicleId);
    model.root.add(this.group);
  }

  private basis() {
    const f = this.model.cabin.look.clone().setY(0).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(f, up).normalize();
    return { f, up, r };
  }

  private buildShell() {
    const cab = this.model.cabin;
    const g = new THREE.SphereGeometry(cab.radius, 96, 64).toNonIndexed();
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const keep: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cen = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      cen.copy(a).add(b).add(c).normalize();
      const open = cab.viewports.some((v) => cen.angleTo(v.dir) < v.half);
      if (!open) for (const p of [a, b, c]) keep.push(p.x, p.y, p.z);
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
    shell.computeVertexNormals();
    const fabric = new THREE.MeshStandardMaterial({
      color: this.style === "future" ? 0x2a2f36 : this.style === "analog" ? 0x5d5a52 : 0x3d4247,
      roughness: 0.85, side: THREE.BackSide,
    });
    this.group.add(new THREE.Mesh(shell, fabric));
    // viewport rims inside
    for (const v of cab.viewports) {
      if (v.half > 1) continue;
      const rr = cab.radius * Math.sin(v.half);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.02, 10, 40), MAT.titanium());
      rim.position.copy(v.dir).multiplyScalar(cab.radius * Math.cos(v.half) - 0.01);
      rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.dir);
      this.group.add(rim);
    }
    // cabin light (dim red/amber for dark adaptation)
    const lamp = new THREE.PointLight(this.style === "future" ? 0x88ccff : 0xffb070, 0.6, cab.radius * 3, 2);
    lamp.position.set(0, cab.radius * 0.6, 0);
    this.group.add(lamp);
  }

  private addScreen(kind: string, w: number, h: number, at: THREE.Vector3, lookAt: THREE.Vector3, px = 512) {
    const canvas = document.createElement("canvas");
    canvas.width = px; canvas.height = Math.round((px * h) / w);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const bezel = roundedBox(w + 0.03, h + 0.03, 0.03, 0.01, MAT.carbon());
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    mesh.position.z = 0.017;
    const holder = new THREE.Group();
    holder.add(bezel, mesh);
    holder.position.copy(at);
    holder.lookAt(lookAt);
    this.group.add(holder);
    this.screens.push({ kind, canvas, tex, mesh, w, h });
  }

  private buildInterior(vehicleId: string) {
    const R = this.model.cabin.radius;
    const { f, up, r } = this.basis();
    const eye = this.model.cabin.eye.clone().sub(this.model.cabin.center);
    const P = (a: number, b: number, c: number) => new THREE.Vector3().addScaledVector(f, a * R).addScaledVector(up, b * R).addScaledVector(r, c * R);
    // floor, seats
    const floor = roundedBox(R * 1.3, 0.04, R * 1.1, 0.02, MAT.paint(0x1c1e21, 0.9));
    floor.position.copy(up).multiplyScalar(-R * 0.62);
    floor.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), f);
    this.group.add(floor);
    const seatMat = MAT.paint(this.style === "future" ? 0x20262e : 0x4b3b2b, 0.8);
    const seats = this.model.cabin.seats;
    for (let i = 0; i < seats; i++) {
      const off = (i - (seats - 1) / 2) * 0.7;
      const seat = roundedBox(R * 0.45, R * 0.12, R * 0.4, 0.04, seatMat);
      seat.position.copy(P(-0.25, -0.5, off));
      this.group.add(seat);
      const back = roundedBox(R * 0.1, R * 0.5, R * 0.4, 0.04, seatMat);
      back.position.copy(P(-0.5, -0.25, off));
      this.group.add(back);
    }
    const target = eye.clone();
    if (this.style === "analog") {
      // Trieste: brass-ring analog gauges and switch panel
      this.addScreen("gauges", R * 0.75, R * 0.3, P(0.4, -0.58, 0.5), target, 768);
      this.addScreen("switches", R * 0.55, R * 0.3, P(0.2, -0.3, -0.72), target);
      return;
    }
    if (this.style === "future") {
      // Nereid-X: wide central display, two wing displays, overhead strip, arm-rest touch panels
      this.addScreen("main", R * 0.95, R * 0.4, P(0.66, -0.22, 0), target, 1024);
      this.addScreen("nav", R * 0.46, R * 0.32, P(0.5, -0.12, 0.7), target);
      this.addScreen("sonar", R * 0.46, R * 0.32, P(0.5, -0.12, -0.7), target);
      this.addScreen("cams", R * 0.62, R * 0.3, P(0.2, 0.62, 0), target);
      this.addScreen("systems", R * 0.4, R * 0.26, P(0.05, -0.5, 0.78), target);
      this.addScreen("lights", R * 0.4, R * 0.26, P(0.05, -0.5, -0.78), target);
      // glowing edge of the console
      const edge = new THREE.Mesh(new THREE.TorusGeometry(R * 0.72, 0.008, 8, 64, Math.PI * 0.9), MAT.glow(0x2ee6ff, 2));
      edge.position.copy(P(0.15, -0.55, 0));
      edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
      edge.rotateZ(Math.atan2(f.z, f.x) + Math.PI * 0.05 - Math.PI / 2);
      this.group.add(edge);
      return;
    }
    // Alvin / Limiting Factor / Mir
    this.addScreen("main", R * 0.7, R * 0.35, P(0.55, -0.3, 0), target, 768);
    this.addScreen("nav", R * 0.42, R * 0.3, P(0.35, -0.2, 0.75), target);
    this.addScreen(vehicleId === "mir" ? "systems" : "sonar", R * 0.42, R * 0.3, P(0.35, -0.2, -0.75), target);
    this.addScreen("cams", R * 0.5, R * 0.26, P(0.1, 0.62, 0.2), target);
    for (let i = 0; i < 12; i++) {
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), MAT.glow(i % 3 ? 0x33ff88 : 0xffaa00, 1.2));
      btn.position.copy(P(0.3, -0.55, -0.4 + i * 0.07));
      this.group.add(btn);
    }
  }

  /** Redraw every display from simulation data. */
  update(d: CockpitData) {
    this.sweep = (this.sweep + 0.12) % 1;
    for (const s of this.screens) {
      const g = s.canvas.getContext("2d")!;
      const W = s.canvas.width, H = s.canvas.height;
      g.fillStyle = this.style === "analog" ? "#1d1a14" : "#05090d";
      g.fillRect(0, 0, W, H);
      g.textBaseline = "top";
      switch (s.kind) {
        case "main": this.drawMain(g, W, H, d); break;
        case "nav": this.drawNav(g, W, H, d); break;
        case "sonar": this.drawSonar(g, W, H, d); break;
        case "systems": this.drawSystems(g, W, H, d); break;
        case "lights": this.drawLights(g, W, H, d); break;
        case "cams": this.drawCams(s, d); break;
        case "gauges": this.drawGauges(g, W, H, d); break;
        case "switches": this.drawSwitches(g, W, H, d); break;
      }
      s.tex.needsUpdate = true;
    }
  }

  private t(d: CockpitData, ru: string, en: string) { return d.lang === "ru" ? ru : en; }

  private drawMain(g: CanvasRenderingContext2D, W: number, H: number, d: CockpitData) {
    const s = H / 200;
    g.fillStyle = CYAN; g.font = `600 ${12 * s}px system-ui`; g.fillText(d.vehicleName.toUpperCase(), 10 * s, 6 * s);
    g.fillStyle = DIM; g.fillText(new Date(d.time * 1000).toISOString().slice(11, 19), W - 70 * s, 6 * s);
    const tile = (x: number, y: number, label: string, val: string, unit: string, col = TXT) => {
      g.strokeStyle = "#16303c"; g.lineWidth = 1.5 * s; g.strokeRect(x, y, W / 4 - 12 * s, 58 * s);
      g.fillStyle = DIM; g.font = `${10 * s}px system-ui`; g.fillText(label, x + 6 * s, y + 5 * s);
      g.fillStyle = col; g.font = `700 ${24 * s}px ui-monospace, monospace`; g.fillText(val, x + 6 * s, y + 20 * s);
      g.fillStyle = DIM; g.font = `${10 * s}px system-ui`; g.fillText(unit, x + 6 * s, y + 46 * s);
    };
    const cw = W / 4;
    const over = d.depth > d.rated;
    tile(8 * s, 24 * s, this.t(d, "ГЛУБИНА", "DEPTH"), d.depth.toFixed(1), "m", over ? RED : CYAN);
    tile(8 * s + cw, 24 * s, this.t(d, "ДАВЛЕНИЕ", "PRESSURE"), (d.pressure / 100).toFixed(2), "MPa");
    tile(8 * s + 2 * cw, 24 * s, this.t(d, "СКОРОСТЬ", "SPEED"), d.speed.toFixed(2), `m/s · ${this.t(d, "верт.", "vert")} ${(-d.vspeed).toFixed(2)}`);
    tile(8 * s + 3 * cw, 24 * s, this.t(d, "ТЕМП. ЗА БОРТОМ", "WATER TEMP"), d.tOut.toFixed(2), `°C · ${this.t(d, "внутри", "cabin")} ${d.tIn.toFixed(1)}`);
    tile(8 * s, 90 * s, this.t(d, "КУРС", "HEADING"), `${Math.round(((90 - (d.heading * 180) / Math.PI) % 360 + 360) % 360)}°`, "true");
    tile(8 * s + cw, 90 * s, this.t(d, "ЭНЕРГИЯ", "ENERGY"), `${(d.battery * 100).toFixed(0)}%`, `${d.batteryKWh.toFixed(1)} kWh · ${d.power.toFixed(1)} kW`, d.battery < 0.15 ? RED : GREEN);
    tile(8 * s + 2 * cw, 90 * s, this.t(d, "КОРПУС", "HULL"), `${(d.hull * 100).toFixed(0)}%`, `${this.t(d, "раб.", "rated")} ${d.rated} m · ${this.t(d, "разруш.", "collapse")} ${d.collapse.toFixed(0)} m`, d.hull < 0.7 ? AMBER : TXT);
    tile(8 * s + 3 * cw, 90 * s, this.t(d, "НАД ДНОМ", "ALTITUDE"), d.altitude < 999 ? d.altitude.toFixed(1) : "—", `m · ${this.t(d, "звук", "c")} ${d.sound.toFixed(0)} m/s`);
    // depth tape
    const frac = Math.min(1, d.depth / d.collapse);
    g.fillStyle = "#0d2230"; g.fillRect(8 * s, 158 * s, W - 16 * s, 10 * s);
    g.fillStyle = over ? RED : CYAN; g.fillRect(8 * s, 158 * s, (W - 16 * s) * frac, 10 * s);
    g.fillStyle = AMBER; g.fillRect(8 * s + (W - 16 * s) * (d.rated / d.collapse), 154 * s, 2 * s, 18 * s);
    // warnings
    g.font = `700 ${11 * s}px system-ui`;
    const warn = d.warnings.length ? d.warnings : [this.t(d, "СИСТЕМЫ В НОРМЕ", "ALL SYSTEMS NOMINAL")];
    g.fillStyle = d.warnings.length ? (Math.floor(d.time * 2) % 2 ? RED : AMBER) : GREEN;
    g.fillText(warn.join("  ·  "), 10 * s, 178 * s);
  }

  private drawNav(g: CanvasRenderingContext2D, W: number, H: number, d: CockpitData) {
    const s = H / 200;
    g.fillStyle = CYAN; g.font = `600 ${12 * s}px system-ui`; g.fillText(this.t(d, "НАВИГАЦИЯ · USBL/DVL", "NAVIGATION · USBL/DVL"), 8 * s, 6 * s);
    const cx = W / 2, cy = H / 2 + 10 * s, sc = (H * 0.4) / Math.max(30, ...d.track.map(([x, y]) => Math.hypot(x - d.x, y - d.y)));
    g.strokeStyle = "#16303c";
    for (let r = 1; r <= 3; r++) { g.beginPath(); g.arc(cx, cy, (H * 0.4 * r) / 3, 0, Math.PI * 2); g.stroke(); }
    g.strokeStyle = GREEN; g.lineWidth = 2 * s; g.beginPath();
    d.track.forEach(([x, y], i) => { const px = cx + (x - d.x) * sc, py = cy - (y - d.y) * sc; i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke();
    g.save(); g.translate(cx, cy); g.rotate(-d.heading + Math.PI / 2);
    g.fillStyle = CYAN; g.beginPath(); g.moveTo(0, -12 * s); g.lineTo(7 * s, 8 * s); g.lineTo(-7 * s, 8 * s); g.fill();
    g.restore();
    g.fillStyle = TXT; g.font = `${10 * s}px ui-monospace, monospace`;
    g.fillText(`E ${d.x.toFixed(0)} m  N ${d.y.toFixed(0)} m`, 8 * s, H - 18 * s);
  }

  private drawSonar(g: CanvasRenderingContext2D, W: number, H: number, d: CockpitData) {
    const s = H / 200;
    g.fillStyle = CYAN; g.font = `600 ${12 * s}px system-ui`; g.fillText(this.t(d, `СОНАР · ${d.sonarRange} м`, `SONAR · ${d.sonarRange} m`), 8 * s, 6 * s);
    const cx = W / 2, cy = H - 8 * s, R = H * 0.85;
    const n = d.sonar.length;
    for (let i = 0; i < n; i++) {
      const a0 = (-60 + (120 * i) / n) * (Math.PI / 180) - Math.PI / 2;
      const a1 = (-60 + (120 * (i + 1)) / n) * (Math.PI / 180) - Math.PI / 2;
      const e = d.sonar[i];
      if (e <= 0) continue;
      const rr = R * Math.min(1, e);
      g.fillStyle = `rgba(255,176,0,${0.35 + 0.5 * (1 - e)})`;
      g.beginPath(); g.arc(cx, cy, rr, a0, a1); g.arc(cx, cy, rr - 6 * s, a1, a0, true); g.fill();
    }
    g.strokeStyle = "#1d4050"; g.lineWidth = 1 * s;
    for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(cx, cy, (R * k) / 4, -Math.PI / 2 - Math.PI / 3, -Math.PI / 2 + Math.PI / 3); g.stroke(); }
    const sw = (-60 + 120 * this.sweep) * (Math.PI / 180) - Math.PI / 2;
    g.strokeStyle = GREEN; g.lineWidth = 2 * s; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sw) * R, cy + Math.sin(sw) * R); g.stroke();
  }

  private drawSystems(g: CanvasRenderingContext2D, W: number, H: number, d: CockpitData) {
    const s = H / 200;
    g.fillStyle = CYAN; g.font = `600 ${12 * s}px system-ui`; g.fillText(this.t(d, "ДВИЖИТЕЛИ · БАЛЛАСТ", "THRUSTERS · BALLAST"), 8 * s, 6 * s);
    const bars: Array<[string, number]> = [["SURGE", d.thrusters.surge], ["SWAY", d.thrusters.sway], ["HEAVE", d.thrusters.heave], ["YAW", d.thrusters.yaw]];
    bars.forEach(([name, v], i) => {
      const y = 30 * s + i * 30 * s;
      g.fillStyle = DIM; g.font = `${10 * s}px system-ui`; g.fillText(name, 8 * s, y);
      g.fillStyle = "#0d2230"; g.fillRect(70 * s, y, W - 80 * s, 14 * s);
      g.fillStyle = Math.abs(v) > 0.8 ? AMBER : GREEN;
      const mid = 70 * s + (W - 80 * s) / 2;
      g.fillRect(Math.min(mid, mid + v * (W - 80 * s) / 2), y, Math.abs(v) * (W - 80 * s) / 2, 14 * s);
    });
    g.fillStyle = TXT; g.font = `${11 * s}px ui-monospace, monospace`;
    g.fillText(`VB ${d.vb.toFixed(0)} kg · ${d.weights}`, 8 * s, 158 * s);
    g.fillText(d.depthHold ? `HOLD ${d.holdDepth.toFixed(0)} m` : "HOLD OFF", 8 * s, 176 * s);
  }

  private drawLights(g: CanvasRenderingContext2D, W: number, H: number, d: CockpitData) {
    const s = H / 200;
    g.fillStyle = CYAN; g.font = `600 ${12 * s}px system-ui`; g.fillText(this.t(d, "ОСВЕЩЕНИЕ", "LIGHTING"), 8 * s, 6 * s);
    for (let i = 0; i < 6; i++) {
      const x = 12 * s + (i % 3) * (W / 3), y = 36 * s + Math.floor(i / 3) * 70 * s;
      g.fillStyle = d.lights ? "#e8f6ff" : "#1a2a33";
      g.beginPath(); g.arc(x + 20 * s, y + 20 * s, 16 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = DIM; g.font = `${10 * s}px system-ui`; g.fillText(`LED ${i + 1}`, x + 4 * s, y + 42 * s);
    }
    g.fillStyle = d.lights ? GREEN : DIM; g.font = `700 ${12 * s}px system-ui`;
    g.fillText(d.lights ? this.t(d, "ВКЛ · L / X", "ON · L / X") : this.t(d, "ВЫКЛ · L / X", "OFF · L / X"), 8 * s, 176 * s);
  }

  private drawCams(s: Screen, d: CockpitData) {
    // camera feeds are shown as child meshes sampling the render targets
    const g = s.canvas.getContext("2d")!;
    const W = s.canvas.width, H = s.canvas.height;
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.fillStyle = CYAN; g.font = `600 ${H / 12}px system-ui`;
    g.fillText(this.t(d, "КАМЕРЫ", "CAMERAS"), 6, 4);
    if (this.feedMeshes.length === 0 && d.camFeeds.length) {
      const n = Math.min(d.camFeeds.length, 3);
      for (let i = 0; i < n; i++) {
        const fm = new THREE.Mesh(new THREE.PlaneGeometry((s.w / n) * 0.94, s.h * 0.78), new THREE.MeshBasicMaterial({ map: d.camFeeds[i], toneMapped: false }));
        fm.position.set(-s.w / 2 + (s.w / n) * (i + 0.5), -s.h * 0.08, 0.002);
        s.mesh.add(fm);
        this.feedMeshes.push(fm);
      }
    }
  }

  private dial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, v: number, max: number, label: string, unit: string) {
    g.fillStyle = "#e9e1c8"; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#8a6d2b"; g.lineWidth = r * 0.12; g.stroke();
    g.strokeStyle = "#222"; g.lineWidth = 1.5;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); g.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9); g.stroke();
    }
    const a = Math.PI * 0.75 + Math.min(1, Math.max(0, v / max)) * Math.PI * 1.5;
    g.strokeStyle = "#a01010"; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); g.stroke();
    g.fillStyle = "#222"; g.font = `${r * 0.2}px Georgia, serif`; g.textAlign = "center";
    g.fillText(label, cx, cy + r * 0.25); g.fillText(unit, cx, cy + r * 0.48); g.textAlign = "left";
  }

  private drawGauges(g: CanvasRenderingContext2D, W: number, H: number, d: CockpitData) {
    const r = H * 0.38;
    this.dial(g, W * 0.14, H * 0.5, r, d.depth, 12000, this.t(d, "ГЛУБИНА", "DEPTH"), `${d.depth.toFixed(0)} m`);
    this.dial(g, W * 0.38, H * 0.5, r, d.pressure / 100, 120, this.t(d, "ДАВЛЕНИЕ", "PRESS."), "MPa");
    this.dial(g, W * 0.62, H * 0.5, r, d.tOut + 5, 35, this.t(d, "ТЕМП.", "TEMP"), `${d.tOut.toFixed(1)} °C`);
    this.dial(g, W * 0.86, H * 0.5, r, d.battery * 100, 100, this.t(d, "БАТАРЕЯ", "BATTERY"), `${(d.battery * 100).toFixed(0)} %`);
  }

  private drawSwitches(g: CanvasRenderingContext2D, W: number, H: number, d: CockpitData) {
    const labels = [["LIGHTS", d.lights], ["SHOT FWD", d.weights.includes("2")], ["SHOT AFT", d.weights !== "0/2"], ["MOTORS", d.thrusters.surge !== 0]] as const;
    labels.forEach(([name, on], i) => {
      const x = 20 + i * (W / 4);
      g.fillStyle = "#3a352b"; g.fillRect(x, 30, W / 5, H - 60);
      g.fillStyle = on ? "#ffcf6a" : "#6b5a3a"; g.beginPath(); g.arc(x + W / 10, 60, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#cfc6ad"; g.font = "18px Georgia, serif"; g.fillText(name, x + 4, H - 60);
    });
    if (d.warnings.length) { g.fillStyle = RED; g.font = "700 22px Georgia, serif"; g.fillText(d.warnings[0], 20, H - 30); }
  }
}
