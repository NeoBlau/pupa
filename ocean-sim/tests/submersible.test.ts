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
    expect(t / 3600).toBeLessThan(4.8);
  });

  it("Trieste becomes heavier with depth: gasoline is more compressible than seawater", () => {
    const env = still("challenger_deep");
    const sub = Submersible.byId("trieste", env.column.t[0]);
    const surf = sub.diagnose(sub.state, env).netDown;
    const deep = sub.diagnose({ ...sub.state, z: 8000, floatTemp: 2.5 }, env).netDown;
    expect(deep).toBeGreaterThan(surf);
  });

  it("dropping weights on the bottom makes Alvin ascend", () => {
    const { sub, env } = diveToBottom("alvin", "tag_vents");
    sub.dropDescentWeights();
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
