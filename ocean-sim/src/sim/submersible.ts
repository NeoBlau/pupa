/**
 * Equations of motion of a crewed submersible in a stratified ocean.
 *
 * Heave (z positive down):
 *   (m + m_a) · dw/dt = (m − ρ(z)·V(z,T)) · g  −  ½ ρ Cd A |w| w
 * with
 *   V(z)  = V_hull·(1 − κ_hull·Δp) + V_float·(1 − κ_float·Δp + β_float·(T_float − T0))
 *   m_a   = C_a · ρ · V               added mass, C_a ≈ 0.5 (sphere-like body)
 *   T_float relaxes to ambient in-situ temperature with time constant τ.
 *
 * Surge/sway: thrusters against quadratic drag relative to the local water
 * velocity (Ekman current + wave orbital motion near the surface).
 *
 * Integrated with classical RK4 at a fixed internal step so time acceleration
 * never changes the physics.
 */
import type { Column } from "../data/profile";
import { grav } from "../science/teos10";
import { sample } from "../data/profile";
import { VEHICLES, type Vehicle, planArea } from "./vehicles";
import { pFromZ, rho as rhoTEOS } from "../science/teos10";

export const DT = 0.05; // s, internal step
const CA = 0.5;
const TAU_FLOAT = 3600; // s, gasoline thermal time constant (est)

export interface Controls {
  /** Variable ballast fill 0…1 (seawater pumped into tanks). */
  vbFill: number;
  /** Horizontal thrust command in body frame, each −1…1. */
  thrustX: number;
  thrustY: number;
  lights: boolean;
}

export interface SubState {
  t: number; // s since dive start
  x: number; y: number; z: number; // m (z down)
  u: number; v: number; w: number; // m/s
  descentWeightsOn: boolean;
  emergencyDropped: boolean;
  floatTemp: number; // °C
  landed: boolean;
  imploded: boolean;
  maxDepth: number;
}

export interface Environment {
  column: Column;
  bottom: number;
  /** Water velocity at depth z [m/s] (east, north). */
  current: (z: number) => [number, number];
  /** Extra vertical water velocity from waves near the surface [m/s]. */
  heave: (z: number, t: number) => number;
}

export class Submersible {
  readonly vehicle: Vehicle;
  state: SubState;
  controls: Controls = { vbFill: 0.5, thrustX: 0, thrustY: 0, lights: true };
  /** Design mass after calibration [kg]. */
  readonly massDry: number;
  readonly hullVolume: number;
  readonly vbMass: number;

  constructor(vehicle: Vehicle, surfaceTemp: number) {
    this.vehicle = vehicle;
    this.surfaceTemp = surfaceTemp;
    this.vbMass = vehicle.variableBallast;
    this.massDry = vehicle.mass - vehicle.descentWeights;
    const cal = calibrate(vehicle, this.massDry + this.vbMass / 2);
    this.hullVolume = cal.volume - vehicle.floatVolume;
    this.calibratedWeights = cal.weights;
    this.state = {
      t: 0, x: 0, y: 0, z: 0.5, u: 0, v: 0, w: 0,
      descentWeightsOn: true, emergencyDropped: false,
      floatTemp: surfaceTemp, landed: false, imploded: false, maxDepth: 0,
    };
  }

  readonly calibratedWeights: number;
  readonly surfaceTemp: number;

  static byId(id: string, surfaceTemp: number) {
    return new Submersible(VEHICLES.find((v) => v.id === id) ?? VEHICLES[0], surfaceTemp);
  }

  mass(s = this.state): number {
    return this.massDry + (s.descentWeightsOn ? this.calibratedWeights : 0) + this.controls.vbFill * this.vbMass;
  }

  volume(pDbar: number, floatTemp: number): number {
    const dp = pDbar * 1e4;
    const v = this.vehicle;
    return (
      this.hullVolume * (1 - v.hullKappa * dp) +
      v.floatVolume * (1 - v.floatKappa * dp + v.floatThermal * (floatTemp - this.surfaceTemp))
    );
  }

  /** Forces and derived quantities at a state — used by RK4 and the HUD. */
  diagnose(s: SubState, env: Environment) {
    const smp = sample(env.column, s.z);
    const V = this.volume(smp.p, s.floatTemp);
    const m = this.mass(s);
    const g = grav(env.column.lat, smp.p);
    const buoyancy = smp.rho * V * g;
    const weight = m * g;
    const [cu, cv] = env.current(s.z);
    const wr = s.w - env.heave(s.z, s.t);
    const A = planArea(this.vehicle);
    const dragZ = -0.5 * smp.rho * this.vehicle.cdVertical * A * Math.abs(wr) * wr;
    const Aside = this.vehicle.width * this.vehicle.height;
    const ur = s.u - cu, vr = s.v - cv;
    const sp = Math.hypot(ur, vr);
    const cdH = 0.9;
    const thrust = this.vehicle.thrust;
    const fx = thrust * this.controls.thrustX - 0.5 * smp.rho * cdH * Aside * sp * ur;
    const fy = thrust * this.controls.thrustY - 0.5 * smp.rho * cdH * Aside * sp * vr;
    const mEff = m + CA * smp.rho * V;
    return { smp, V, m, mEff, buoyancy, weight, dragZ, fx, fy, netDown: weight - buoyancy };
  }

  private deriv(s: SubState, env: Environment) {
    const d = this.diagnose(s, env);
    let az = (d.weight - d.buoyancy + d.dragZ) / d.mEff;
    if (s.landed && az > 0) az = 0;
    return {
      dx: s.u, dy: s.v, dz: s.w,
      du: d.fx / d.mEff, dv: d.fy / d.mEff, dw: az,
      dT: (d.smp.t - s.floatTemp) / TAU_FLOAT,
    };
  }

  /** Advance simulated time by `seconds` using fixed RK4 steps. */
  step(seconds: number, env: Environment) {
    let remaining = seconds;
    while (remaining > 1e-9 && !this.state.imploded) {
      const h = Math.min(DT, remaining);
      remaining -= h;
      const s = this.state;
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

      if (s.z < 0) { s.z = 0; s.w = Math.max(s.w, 0); }
      if (s.z >= env.bottom) {
        s.z = env.bottom;
        if (s.w > 0) s.w = 0;
        s.landed = true;
      } else if (s.z < env.bottom - 0.05) {
        s.landed = false;
      }
      s.maxDepth = Math.max(s.maxDepth, s.z);
      // Typical pressure-hull design safety factor 1.5 over rated depth.
      if (s.z > this.vehicle.ratedDepth * 1.5) s.imploded = true;
    }
  }

  dropDescentWeights() { this.state.descentWeightsOn = false; }

  /** Emergency ascent: release every droppable weight and blow variable ballast. */
  emergencyAscent() {
    this.state.descentWeightsOn = false;
    this.state.emergencyDropped = true;
    this.controls.vbFill = 0;
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
  return { volume, weights };
}
