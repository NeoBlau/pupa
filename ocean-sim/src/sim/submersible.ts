/**
 * Equations of motion of a crewed submersible in a stratified ocean, from
 * floating at the surface down to the seafloor.
 *
 * Heave (z positive down, 0 = mean sea level; z < 0 means partly out of water):
 *   (m + f·m_a)·dw/dt = m·g − f·ρ(z)·V(z,T)·g − ½ρ·Cd·A·f·|w_r|·w_r + F_vert
 * with the submerged fraction f = clamp((z + η + H/2)/H, 0, 1), η the local
 * wave elevation, so the craft floats in the waves when positively buoyant.
 *   V(z)  = V_hull·(1 − κ_hull·Δp) + V_float·(1 − κ_float·Δp + β_float·(T_float − T0))
 *   m_a   = C_a · ρ · V, C_a ≈ 0.5
 *
 * Horizontal: body-frame thrusters (surge, sway) and yaw against quadratic drag
 * relative to the local water velocity (Ekman current, Gulf Stream core).
 *
 * Variable ballast is pumped, not teleported: flooding is free, pumping water
 * out costs E = p·ΔV/η_pump — at 11 km that is ~3 kWh per 100 kg.
 *
 * Integrated with RK4 at a fixed internal step (time warp never changes the
 * trajectory).
 */
import type { Column } from "../data/profile";
import { sample } from "../data/profile";
import { grav, pFromZ, rho as rhoTEOS } from "../science/teos10";
import { forwardThrust, frontArea, planArea, VEHICLES, type Vehicle } from "./vehicles";

export const DT = 0.05; // s, internal step
const CA = 0.5;
const TAU_FLOAT = 3600; // s, gasoline thermal time constant (est)
const PUMP_RATE = 2; // kg/s of seawater
const PUMP_EFF = 0.6;
const LOW_BATTERY = 0.1;
const MBT_RESERVE = 0.12; // soft tanks float the craft with all weights on plus 12 % of its mass as freeboard (est)
const MBT_RATE = 1 / 60; // full blow or vent in ~60 s

export interface Controls {
  /** Variable ballast target fill 0…1. */
  vbFill: number;
  /** Body-frame commands −1…1. */
  surge: number;
  sway: number;
  /** Vertical thrusters, + = down. */
  heave: number;
  /** Yaw command, + = turn left (counter-clockwise from above). */
  yaw: number;
  lights: boolean;
  depthHold: boolean;
  holdDepth: number;
  /** Main ballast tanks: true = blow with air (surface), false = vent (dive). */
  mbtBlow: boolean;
}

export interface SubState {
  t: number;
  x: number; y: number; z: number; // m (x east, y north, z down)
  u: number; v: number; w: number; // m/s
  heading: number; // rad, 0 = east, counter-clockwise
  yawRate: number; // rad/s
  vbMass: number; // kg of water in the variable-ballast tanks
  /** Air fraction of the soft (main) ballast tanks used only at the surface, 0…1. */
  mbtAir: number;
  battery: number; // J remaining
  descentWeightsOn: boolean;
  /** Ascent weights keep the craft near neutral on the bottom; dropping them starts the ascent. */
  ascentWeightsOn: boolean;
  emergencyDropped: boolean;
  floatTemp: number; // °C
  landed: boolean;
  imploded: boolean;
  maxDepth: number;
  hull: number; // structural integrity 0…1
  submerged: number; // fraction 0…1
}

export interface Obstacle { x: number; y: number; z: number; r: number }

export interface Environment {
  column: Column;
  /** Mean seafloor depth [m]. */
  bottom: number;
  /** Local seafloor depth at (x, y) [m]; defaults to `bottom`. */
  floor?: (x: number, y: number) => number;
  /** Water velocity at depth z [m/s] (east, north). */
  current: (z: number) => [number, number];
  /** Vertical water velocity from waves [m/s]. */
  heave: (z: number, t: number) => number;
  /** Sea-surface elevation η(x, y, t) [m, up]. */
  eta?: (x: number, y: number, t: number) => number;
  obstacles?: Obstacle[];
}

export type SubEvent =
  | { kind: "impact"; speed: number }
  | { kind: "overdepth" }
  | { kind: "lowBattery" }
  | { kind: "batteryEmpty" }
  | { kind: "surfaced" }
  | { kind: "submerged" }
  | { kind: "imploded" };

export class Submersible {
  readonly vehicle: Vehicle;
  state: SubState;
  controls: Controls = { vbFill: 0.5, surge: 0, sway: 0, heave: 0, yaw: 0, lights: true, depthHold: false, holdDepth: 0, mbtBlow: false };
  readonly massDry: number;
  readonly hullVolume: number;
  readonly vbMass: number;
  /** Total droppable weight [kg] = descent + ascent weights. */
  readonly calibratedWeights: number;
  readonly descentWeightMass: number;
  readonly ascentWeightMass: number;
  readonly surfaceTemp: number;
  readonly batteryJ: number;
  readonly thrustMax: number;
  /** Soft-tank volume [m³]. */
  readonly mbtVolume: number;
  /** Events since the last drain (impacts, surfacing…) for HUD, log and rumble. */
  private events: SubEvent[] = [];
  // a craft starts at the surface: auto-blow only triggers after it has been under and comes back up
  private flags = { overdepth: false, low: false, empty: false, surfaced: true };

  constructor(vehicle: Vehicle, surfaceTemp: number) {
    this.vehicle = vehicle;
    this.surfaceTemp = surfaceTemp;
    this.vbMass = vehicle.variableBallast;
    this.massDry = vehicle.mass - vehicle.descentWeights;
    const cal = calibrate(vehicle, this.massDry + this.vbMass / 2);
    this.hullVolume = cal.volume - vehicle.floatVolume;
    this.calibratedWeights = cal.weights;
    // Ascent weights: the part that makes the craft neutral at half the rated
    // depth in the standard ocean (with half-full variable ballast).
    this.ascentWeightMass = Math.min(cal.weights, Math.max(0, cal.neutralMass - (this.massDry + this.vbMass / 2)));
    this.descentWeightMass = cal.weights - this.ascentWeightMass;
    this.batteryJ = vehicle.battery * 3.6e6;
    this.thrustMax = forwardThrust(vehicle);
    this.mbtVolume = (cal.weights + MBT_RESERVE * vehicle.mass) / 1020;
    this.state = {
      t: 0, x: 0, y: 0, z: 0.5, u: 0, v: 0, w: 0, heading: Math.PI / 2, yawRate: 0,
      vbMass: this.vbMass / 2, mbtAir: 0, battery: this.batteryJ,
      descentWeightsOn: true, ascentWeightsOn: true, emergencyDropped: false,
      floatTemp: surfaceTemp, landed: false, imploded: false, maxDepth: 0, hull: 1, submerged: 1,
    };
  }

  static byId(id: string, surfaceTemp: number) {
    return new Submersible(VEHICLES.find((v) => v.id === id) ?? VEHICLES[0], surfaceTemp);
  }

  drainEvents(): SubEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  mass(s = this.state): number {
    return this.massDry + (s.descentWeightsOn ? this.descentWeightMass : 0) + (s.ascentWeightsOn ? this.ascentWeightMass : 0) + s.vbMass;
  }

  volume(pDbar: number, floatTemp: number): number {
    const dp = Math.max(pDbar, 0) * 1e4;
    const v = this.vehicle;
    return (
      this.hullVolume * (1 - v.hullKappa * dp) +
      v.floatVolume * (1 - v.floatKappa * dp + v.floatThermal * (floatTemp - this.surfaceTemp))
    );
  }

  get powered() { return this.state.battery > 0; }

  /** Collapse depth of the pressure hull [m]. */
  get collapseDepth() { return this.vehicle.ratedDepth * this.vehicle.collapseFactor; }

  floorAt(env: Environment, x: number, y: number) {
    return env.floor ? env.floor(x, y) : env.bottom;
  }

  /** Forces and derived quantities at a state — used by RK4 and the HUD. */
  diagnose(s: SubState, env: Environment) {
    const v = this.vehicle;
    const smp = sample(env.column, Math.max(s.z, 0));
    const eta = env.eta ? env.eta(s.x, s.y, s.t) : 0;
    const H = v.height;
    const f = Math.min(1, Math.max(0, (s.z + eta + H / 2) / H));
    const V = this.volume(smp.p, s.floatTemp);
    const m = this.mass(s);
    const g = grav(env.column.lat, Math.max(smp.p, 0));
    // Main (soft) ballast tanks, air-filled at the surface, sized to float the craft with its weights on.
    const Vmbt = this.mbtVolume * s.mbtAir;
    const buoyancy = f * smp.rho * (V + Vmbt) * g;
    const weight = m * g;
    const [cu, cv] = env.current(Math.max(s.z, 0));
    const wr = s.w - env.heave(Math.max(s.z, 0), s.t);
    const dragZ = -0.5 * smp.rho * v.cdVertical * planArea(v) * Math.max(f, 0.05) * Math.abs(wr) * wr;
    const on = this.powered ? 1 : 0;
    const bite = on * Math.min(1, f * 1.5); // thrusters only bite when submerged
    const fz = v.verticalThrust * this.controls.heave * bite;
    const c = Math.cos(s.heading), sn = Math.sin(s.heading);
    const tSurge = this.thrustMax * this.controls.surge * bite;
    const tSway = 0.5 * this.thrustMax * this.controls.sway * bite;
    const ur = s.u - cu, vr = s.v - cv;
    const sp = Math.hypot(ur, vr);
    const Af = frontArea(v);
    const fx = tSurge * c - tSway * sn - 0.5 * smp.rho * 0.9 * Af * Math.max(f, 0.3) * sp * ur;
    const fy = tSurge * sn + tSway * c - 0.5 * smp.rho * 0.9 * Af * Math.max(f, 0.3) * sp * vr;
    const mEff = m + CA * f * smp.rho * V;
    return { smp, V, m, mEff, buoyancy, weight, dragZ, fx, fy, fz, eta, f, netDown: weight - buoyancy };
  }

  private deriv(s: SubState, env: Environment) {
    const d = this.diagnose(s, env);
    let az = (d.weight - d.buoyancy + d.dragZ + d.fz) / d.mEff;
    if (s.landed && az > 0) az = 0;
    return {
      dx: s.u, dy: s.v, dz: s.w,
      du: d.fx / d.mEff, dv: d.fy / d.mEff, dw: az,
      dT: (d.smp.t - s.floatTemp) / TAU_FLOAT,
    };
  }

  /** Autopilot: holds a target depth with vertical thrusters, trimming ballast toward neutral. */
  private autopilot(dt: number) {
    const c = this.controls, s = this.state;
    if (!c.depthHold) return;
    const err = c.holdDepth - s.z; // + → need to go down
    if (this.vehicle.verticalThrust > 0) c.heave = Math.max(-1, Math.min(1, 0.08 * err - 0.9 * s.w));
    const trim = Math.max(-1, Math.min(1, 0.05 * err - 1.0 * s.w));
    c.vbFill = Math.max(0, Math.min(1, c.vbFill + trim * dt * 0.05));
  }

  /** Advance simulated time by `seconds` using fixed RK4 steps. */
  step(seconds: number, env: Environment) {
    let remaining = seconds;
    const v = this.vehicle;
    while (remaining > 1e-9 && !this.state.imploded) {
      const h = Math.min(DT, remaining);
      remaining -= h;
      const s = this.state;
      this.autopilot(h);

      // variable ballast: flood (free) or pump out (costs energy against pressure)
      const target = this.controls.vbFill * this.vbMass;
      const dm = Math.max(-PUMP_RATE * h, Math.min(PUMP_RATE * h, target - s.vbMass));
      let pumpJ = 0;
      if (dm < 0) {
        if (this.powered) {
          const p = Math.max(pFromZ(-Math.max(s.z, 0), env.column.lat), 0) * 1e4 + 101325;
          pumpJ = (p * (-dm / 1025)) / PUMP_EFF;
          s.vbMass += dm;
        }
      } else s.vbMass += dm;

      // main ballast tanks: blowing only works with the tank vents near the surface
      if (this.controls.mbtBlow && s.z < 3) s.mbtAir = Math.min(1, s.mbtAir + MBT_RATE * h);
      if (!this.controls.mbtBlow) s.mbtAir = Math.max(0, s.mbtAir - MBT_RATE * h);

      // yaw: first-order response to the command
      const rMax = (v.yawRate * Math.PI) / 180;
      const on = this.powered ? 1 : 0;
      s.yawRate += ((this.controls.yaw * rMax * on * Math.min(1, s.submerged * 1.5) - s.yawRate) / 1.5) * h;
      s.heading += s.yawRate * h;

      const add = (k: ReturnType<Submersible["deriv"]>, f: number): SubState => ({
        ...s,
        x: s.x + k.dx * f, y: s.y + k.dy * f, z: s.z + k.dz * f,
        u: s.u + k.du * f, v: s.v + k.dv * f, w: s.w + k.dw * f,
        floatTemp: s.floatTemp + k.dT * f,
      });
      const k1 = this.deriv(s, env);
      const k2 = this.deriv(add(k1, h / 2), env);
      const k3 = this.deriv(add(k2, h / 2), env);
      const k4 = this.deriv(add(k3, h), env);
      const c = (a: number, b: number, cc: number, d: number) => (h / 6) * (a + 2 * b + 2 * cc + d);
      s.x += c(k1.dx, k2.dx, k3.dx, k4.dx);
      s.y += c(k1.dy, k2.dy, k3.dy, k4.dy);
      s.z += c(k1.dz, k2.dz, k3.dz, k4.dz);
      s.u += c(k1.du, k2.du, k3.du, k4.du);
      s.v += c(k1.dv, k2.dv, k3.dv, k4.dv);
      s.w += c(k1.dw, k2.dw, k3.dw, k4.dw);
      s.floatTemp += c(k1.dT, k2.dT, k3.dT, k4.dT);
      s.t += h;

      // energy
      const ctl = this.controls;
      const thrustUse = (Math.abs(ctl.surge) + Math.abs(ctl.sway) * 0.5 + (v.verticalThrust > 0 ? Math.abs(ctl.heave) : 0) + Math.abs(ctl.yaw) * 0.3) / 2.8;
      const P = (v.hotelLoad * 1e3 + (ctl.lights ? v.lightsW : 0) + thrustUse * v.thrusterPower * 1e3) * on;
      s.battery = Math.max(0, s.battery - P * h - pumpJ);
      if (!this.flags.low && s.battery < LOW_BATTERY * this.batteryJ) { this.flags.low = true; this.events.push({ kind: "lowBattery" }); }
      if (!this.flags.empty && s.battery <= 0) { this.flags.empty = true; ctl.lights = false; this.events.push({ kind: "batteryEmpty" }); }

      // surface
      const d = this.diagnose(s, env);
      s.submerged = d.f;
      if (d.f < 0.98 && !this.flags.surfaced) {
        this.flags.surfaced = true;
        this.controls.mbtBlow = true; // standard practice: blow the soft tanks on surfacing
        this.controls.depthHold = false;
        this.events.push({ kind: "surfaced" });
      }
      if (this.flags.surfaced && s.z > v.height) { this.flags.surfaced = false; this.events.push({ kind: "submerged" }); }
      if (s.z < -v.height) { s.z = -v.height; s.w = Math.max(s.w, 0); }

      // seafloor contact: the bottom of the hull touches the local floor
      const floor = this.floorAt(env, s.x, s.y) - v.height / 2;
      if (s.z >= floor) {
        const impact = Math.hypot(s.w, s.u, s.v);
        if (!s.landed && impact > 0.25) this.hit(impact);
        s.z = floor;
        if (s.w > 0) s.w = 0;
        s.u *= 0.9; s.v *= 0.9;
        s.landed = true;
      } else if (s.z < floor - 0.05) s.landed = false;

      // obstacles (wreck, rocks): push out of bounding spheres
      for (const o of env.obstacles ?? []) {
        const dx = s.x - o.x, dy = s.y - o.y, dz = s.z - o.z;
        const dist = Math.hypot(dx, dy, dz);
        const rr = o.r + v.length / 2;
        if (dist < rr && dist > 1e-6) {
          const nx = dx / dist, ny = dy / dist, nz = dz / dist;
          const vn = s.u * nx + s.v * ny + s.w * nz;
          if (vn < 0) {
            if (-vn > 0.25) this.hit(-vn);
            s.u -= 1.3 * vn * nx; s.v -= 1.3 * vn * ny; s.w -= 1.3 * vn * nz;
          }
          s.x = o.x + nx * rr; s.y = o.y + ny * rr; s.z = o.z + nz * rr;
        }
      }

      s.maxDepth = Math.max(s.maxDepth, s.z);
      const over = s.z > v.ratedDepth;
      if (over && !this.flags.overdepth) this.events.push({ kind: "overdepth" });
      this.flags.overdepth = over;
      if (s.z > this.collapseDepth || s.hull <= 0) { s.imploded = true; this.events.push({ kind: "imploded" }); }
    }
  }

  private hit(speed: number) {
    this.state.hull = Math.max(0, this.state.hull - 0.02 * speed * speed);
    this.events.push({ kind: "impact", speed });
  }

  /** Drop the next weight set: descent weights first (→ ~neutral), then ascent weights (→ rise). Returns kg dropped. */
  dropWeights(): number {
    const s = this.state;
    if (s.descentWeightsOn) { s.descentWeightsOn = false; return this.descentWeightMass; }
    if (s.ascentWeightsOn) { s.ascentWeightsOn = false; this.controls.depthHold = false; return this.ascentWeightMass; }
    return 0;
  }

  /** Drop every weight set at once. */
  dropDescentWeights() { this.state.descentWeightsOn = false; this.state.ascentWeightsOn = false; }

  /** Emergency ascent: release every droppable weight and blow ballast with the gas flask. */
  emergencyAscent() {
    this.state.descentWeightsOn = false;
    this.state.ascentWeightsOn = false;
    this.state.emergencyDropped = true;
    this.controls.vbFill = 0;
    this.controls.depthHold = false;
    this.state.vbMass = 0;
  }

  /** Vent the soft tanks and flood variable ballast to leave the surface. */
  dive() {
    this.controls.mbtBlow = false;
    this.controls.vbFill = 1;
  }

  /** Depth hold can only succeed once the craft is near neutral (descent weights dropped). */
  get canHold() {
    return !this.state.descentWeightsOn;
  }

  toggleDepthHold() {
    this.controls.depthHold = !this.controls.depthHold;
    this.controls.holdDepth = Math.max(this.state.z, 2);
    if (!this.controls.depthHold) this.controls.heave = 0;
    return this.controls.depthHold;
  }
}

/**
 * Calibrate displaced volume and descent-weight mass so that, in a standard
 * ocean (SA = 35 g/kg, CT = 1.5 + 18.5·e^(−z/600) °C), the quasi-steady transit
 * time over the rated depth equals the historical descent and ascent times.
 * Quasi-steady: w(z) = √(2·|net(z)| / (ρ Cd A)), time = ∫ dz / w.
 * This captures the real effect that seawater is ~5 % denser at 11 km while
 * titanium hulls and syntactic foam compress less, so a craft gets lighter
 * with depth and must carry extra descent weight.
 */
export function calibrate(v: Vehicle, massNoWeights: number) {
  const D = v.ratedDepth;
  const N = 400;
  const A = planArea(v);
  const g = 9.81;
  const col = Array.from({ length: N }, (_, i) => {
    const z = ((i + 0.5) * D) / N;
    const CT = 1.5 + 18.5 * Math.exp(-z / 600);
    const p = pFromZ(-z, 30);
    return { p, CT, rho: rhoTEOS(35, CT, p) };
  });
  const T0 = col[0].CT;
  const vol = (V0: number, p: number, T: number) =>
    (V0 - v.floatVolume) * (1 - v.hullKappa * p * 1e4) +
    v.floatVolume * (1 - v.floatKappa * p * 1e4 + v.floatThermal * (T - T0));
  const transit = (m: number, V0: number, dir: 1 | -1) => {
    let t = 0;
    for (const c of col) {
      const net = dir * (m - c.rho * vol(V0, c.p, c.CT)) * g;
      if (net <= 0) return Infinity;
      t += D / N / Math.sqrt((2 * net) / (c.rho * v.cdVertical * A));
    }
    return t;
  };
  const bisect = (f: (x: number) => number, target: number, lo: number, hi: number, decreasing: boolean) => {
    for (let i = 0; i < 80; i++) {
      const mid = 0.5 * (lo + hi);
      const tooSlow = f(mid) > target;
      if (tooSlow === decreasing) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  const volume = bisect((V0) => transit(massNoWeights, V0, -1), D / v.ascentSpeed, massNoWeights / 1100, massNoWeights / 900, true);
  const weights = bisect((W) => transit(massNoWeights + W, volume, 1), D / v.descentSpeed, 0, 0.3 * v.mass, true);
  const mid = col[Math.floor(N / 2)];
  const neutralMass = mid.rho * vol(volume, mid.p, mid.CT);
  return { volume, weights, neutralMass };
}
