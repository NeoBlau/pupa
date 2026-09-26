import { describe, expect, it } from "vitest";
import ref from "./fixtures/gsw_reference.json";
import * as t10 from "../src/science/teos10";

// Tolerances are relative to round-off of the 75-term polynomial; any
// transcription error in a coefficient would blow far past them.
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

describe(`TEOS-10 vs Python gsw ${ref.gsw_version}`, () => {
  it("in-situ density, α, β, sound speed, σ0 over SA 0–42, CT −2…33, p 0–11000", () => {
    for (const c of ref.cases) {
      expect(rel(t10.rho(c.SA, c.CT, c.p), c.rho)).toBeLessThan(1e-12);
      expect(rel(t10.alpha(c.SA, c.CT, c.p), c.alpha)).toBeLessThan(1e-9);
      expect(rel(t10.beta(c.SA, c.CT, c.p), c.beta)).toBeLessThan(1e-9);
      expect(rel(t10.soundSpeed(c.SA, c.CT, c.p), c.sound_speed)).toBeLessThan(1e-12);
      expect(Math.abs(t10.sigma0(c.SA, c.CT) - c.sigma0)).toBeLessThan(1e-9);
    }
  });

  it("pressure ↔ depth and gravity, including Challenger Deep", () => {
    for (const d of ref.depth) {
      expect(Math.abs(t10.pFromZ(d.z, d.lat) - d.p)).toBeLessThan(1e-8);
      expect(Math.abs(t10.zFromP(d.p, d.lat) - d.z_back)).toBeLessThan(1e-8);
      expect(rel(t10.grav(d.lat, d.p), d.grav)).toBeLessThan(1e-12);
    }
  });

  it("freezing temperature (polynomial; stated error vs exact < 6e-4 K)", () => {
    for (const f of ref.freezing) {
      expect(Math.abs(t10.ctFreezing(f.SA, f.p) - f.ct_freezing_poly)).toBeLessThan(1e-12);
      expect(Math.abs(t10.ctFreezing(f.SA, f.p) - f.ct_freezing)).toBeLessThan(6e-4);
    }
  });

  it("N² discretisation matches gsw.Nsquared", () => {
    const n = ref.nsquared;
    const { N2, pMid } = t10.nSquared(n.SA, n.CT, n.p, n.lat);
    expect(pMid).toEqual(n.p_mid);
    N2.forEach((v, i) => expect(rel(v, n.N2[i])).toBeLessThan(1e-9));
  });
});

describe("physical sanity", () => {
  it("SOFAR axis sits near 1000 m in a mid-latitude profile", () => {
    const p = Array.from({ length: 50 }, (_, i) => i * 100);
    const c = p.map((pi) => t10.soundSpeed(35, 2 + 18 * Math.exp(-pi / 600), pi));
    const axis = t10.sofarAxis(p, c);
    expect(axis.p).toBeGreaterThan(500);
    expect(axis.p).toBeLessThan(1600);
  });

  it("Mackenzie (1981) nine-term equation is transcribed correctly", () => {
    // Hand-evaluated nine-term sum at t=25 °C, S=35, D=1000 m → 1550.744 m/s
    expect(t10.soundSpeedMackenzie(25, 35, 1000)).toBeCloseTo(1550.744, 2);
  });
});
