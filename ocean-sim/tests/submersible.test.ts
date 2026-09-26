import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { FallbackBundle } from "../src/data/profile";
import { Submersible, type Environment } from "../src/sim/submersible";

const fb = JSON.parse(readFileSync(new URL("../public/data/fallback.json", import.meta.url), "utf8")) as FallbackBundle;
const still = (colName: string): Environment => {
  const column = fb.missions[colName];
  return { column, bottom: column.bottom, current: () => [0, 0], heave: () => 0 };
};

function diveToBottom(id: string, mission: string) {
  const env = still(mission);
  const sub = Submersible.byId(id, env.column.t[0]);
  let t = 0;
  while (!sub.state.landed && t < 10 * 3600) { sub.step(10, env); t += 10; }
  return { sub, env, t };
}

describe("submersible dynamics", () => {
  it("Limiting Factor reaches Challenger Deep in about 4 h (historical ≈ 4 h)", () => {
    const { sub, t } = diveToBottom("limiting_factor", "challenger_deep");
    expect(sub.state.landed).toBe(true);
    expect(t / 3600).toBeGreaterThan(3.2);
    // The trench column is colder (denser) than the standard ocean used for
    // calibration, so the craft is slightly lighter there and slower (~4.8 h).
    expect(t / 3600).toBeLessThan(5.0);
  });

  it("Trieste becomes heavier with depth: gasoline is more compressible than seawater", () => {
    const env = still("challenger_deep");
    const sub = Submersible.byId("trieste", env.column.t[0]);
    const surf = sub.diagnose({ ...sub.state, z: 20 }, env).netDown;
    const deep = sub.diagnose({ ...sub.state, z: 8000, floatTemp: 2.5 }, env).netDown;
    expect(deep).toBeGreaterThan(surf);
  });

  it("on the bottom: first drop → near neutral, second drop → ascend", () => {
    const { sub, env } = diveToBottom("alvin", "tag_vents");
    sub.dropWeights();
    const d = sub.diagnose(sub.state, env);
    expect(Math.abs(d.netDown / 9.81)).toBeLessThan(sub.vbMass); // trim-able with variable ballast
    sub.dropWeights();
    sub.step(600, env);
    expect(sub.state.w).toBeLessThan(0);
    expect(sub.state.z).toBeLessThan(env.bottom - 100);
  });

  it("time acceleration does not change the result (fixed internal step)", () => {
    const env = still("gulf_stream");
    const a = Submersible.byId("mir", env.column.t[0]);
    const b = Submersible.byId("mir", env.column.t[0]);
    a.step(1200, env);
    for (let i = 0; i < 1200 * 20; i++) b.step(0.05, env);
    expect(Math.abs(a.state.z - b.state.z)).toBeLessThan(1e-6);
  });
});

import { VEHICLES } from "../src/sim/vehicles";
describe("calibration is physically consistent", () => {
  it.each(VEHICLES.map((v) => [v.id]))("%s: positive hull volume and non-negative weights", (id) => {
    const sub = Submersible.byId(id, 25);
    expect(sub.hullVolume).toBeGreaterThan(0);
    expect(sub.calibratedWeights).toBeGreaterThan(0);
    // mean density at the surface must be close to seawater (±10 %)
    const rhoMean = sub.mass() / sub.volume(0, 25);
    expect(rhoMean).toBeGreaterThan(930);
    expect(rhoMean).toBeLessThan(1130);
  });
});

describe("surface, re-dive, depth hold, energy", () => {
  const waves = (column: FallbackBundle["missions"][string]): Environment => ({
    column, bottom: column.bottom, current: () => [0, 0], heave: () => 0,
    eta: (x, y, t) => 0.5 * Math.cos(0.6 * t + 0.05 * x),
  });

  it("surfaces, floats with freeboard in waves, then dives again (no teleport)", () => {
    const env = waves(fb.missions.tag_vents);
    const sub = Submersible.byId("alvin", env.column.t[0]);
    sub.step(120, env);
    expect(sub.state.z).toBeGreaterThan(20); // sinking with weights on
    sub.emergencyAscent();
    let prev = sub.state.z, maxJump = 0;
    for (let i = 0; i < 6000 && sub.state.submerged >= 0.999; i++) {
      sub.step(0.5, env); maxJump = Math.max(maxJump, Math.abs(sub.state.z - prev)); prev = sub.state.z;
    }
    expect(maxJump).toBeLessThan(1); // smooth: < 1 m per 0.5 s
    sub.step(300, env);
    expect(sub.state.submerged).toBeLessThan(1); // floating with part of the hull out of the water
    expect(sub.state.z).toBeLessThan(sub.vehicle.height / 2);
    // bob with the waves: z changes over a wave period
    const zs: number[] = [];
    for (let i = 0; i < 40; i++) { sub.step(0.5, env); zs.push(sub.state.z); }
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.1);
    // dive again with vertical thrusters and flooded ballast
    expect(sub.state.mbtAir).toBeGreaterThan(0.9); // soft tanks blown on surfacing
    sub.dive(); sub.controls.heave = 1;
    sub.step(600, env);
    expect(sub.state.z).toBeGreaterThan(10);
    const ev = sub.drainEvents().map((e) => e.kind);
    expect(ev).toContain("surfaced");
    expect(ev).toContain("submerged");
  });

  it("depth hold keeps the craft within ±3 m of the target", () => {
    const env = waves(fb.missions.gulf_stream);
    const sub = Submersible.byId("nereid_x", env.column.t[0]);
    sub.step(200, env);
    sub.dropWeights(); // descent weights only → near neutral
    sub.step(5, env);
    sub.toggleDepthHold();
    const target = sub.controls.holdDepth;
    sub.step(600, env);
    expect(Math.abs(sub.state.z - target)).toBeLessThan(3);
  });

  it("pumping ballast out costs more energy at depth (E = p·ΔV)", () => {
    const env = still("challenger_deep");
    const cost = (z: number) => {
      const s = Submersible.byId("limiting_factor", env.column.t[0]);
      s.controls.lights = false;
      s.state.z = z; s.state.landed = true;
      s.state.vbMass = s.vbMass; s.controls.vbFill = 0;
      const e0 = s.state.battery; s.step(5, env);
      return e0 - s.state.battery;
    };
    expect(cost(10000)).toBeGreaterThan(3 * cost(100));
  });

  it("hitting the seafloor fast is reported as an impact and damages the hull", () => {
    const env = still("red_sea");
    const sub = Submersible.byId("mir", env.column.t[0]);
    sub.state.z = env.bottom - 10; sub.state.w = 2.5;
    sub.step(10, env);
    expect(sub.drainEvents().some((e) => e.kind === "impact")).toBe(true);
    expect(sub.state.hull).toBeLessThan(1);
  });

  it("Nereid-X is the fastest and most agile, but draws the most power", () => {
    const n = VEHICLES.find((v) => v.id === "nereid_x")!;
    for (const v of VEHICLES.filter((x) => x.id !== "nereid_x")) {
      expect(n.maxSpeed).toBeGreaterThan(v.maxSpeed);
      expect(n.yawRate).toBeGreaterThan(v.yawRate);
      expect(n.thrusterPower).toBeGreaterThan(v.thrusterPower);
    }
    expect(VEHICLES.map((v) => v.id)).toEqual(["trieste", "alvin", "limiting_factor", "mir", "nereid_x"]);
  });
});

describe("launch at the surface", () => {
  it.each(VEHICLES.map((v) => [v.id]))("%s floats with weights on and soft tanks blown, sinks after venting", (id) => {
    const column = fb.missions.gulf_stream;
    const env: Environment = { column, bottom: column.bottom, current: () => [0, 0], heave: () => 0, eta: () => 0 };
    const sub = Submersible.byId(id, column.t[0]);
    sub.controls.mbtBlow = true; sub.state.mbtAir = 1; sub.state.z = -0.2;
    sub.step(120, env);
    expect(sub.state.submerged).toBeLessThan(1);
    sub.dive();
    sub.step(240, env);
    expect(sub.state.z).toBeGreaterThan(20);
  });
});
