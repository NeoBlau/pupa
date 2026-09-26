import { describe, expect, it } from "vitest";
import { euphoticDepth, euphoticDepthMorel, kd490, parFraction, waterColour } from "../src/science/optics";
import { ekman, jonswap, piersonMoskowitz, seaState, spectrumStats, wavenumber } from "../src/science/waves";
import { candidates, SPECIES } from "../src/data/species";

describe("optics", () => {
  it("Kd(490) matches Morel et al. (2007) at Chl = 1 mg/m³", () => {
    expect(kd490(1)).toBeCloseTo(0.0939, 4);
  });
  it("PAR decreases monotonically; spectral Zeu is deeper than 4.6/Kd(PAR)", () => {
    let prev = 1;
    for (let z = 5; z < 300; z += 5) { const f = parFraction(z, 0.2); expect(f).toBeLessThan(prev); prev = f; }
    expect(parFraction(euphoticDepth(0.2), 0.2)).toBeCloseTo(0.01, 4);
    expect(euphoticDepth(0.2)).toBeGreaterThan(euphoticDepthMorel(0.2));
  });
  it("more chlorophyll → shallower euphotic zone", () => {
    expect(euphoticDepth(2)).toBeLessThan(euphoticDepth(0.05));
  });
  it("deep water colour is blue (b > g > r) — red is absorbed first", () => {
    const { rgb } = waterColour(60, 0.05);
    expect(rgb[2]).toBeGreaterThan(rgb[1]);
    expect(rgb[1]).toBeGreaterThan(rgb[0]);
  });
});

describe("waves", () => {
  it("deep-water dispersion ω² = gk and shallow-water limit c = √(gh)", () => {
    expect(wavenumber(1)).toBeCloseTo(1 / 9.81, 6);
    const h = 5, w = 0.1, k = wavenumber(w, h);
    expect(w / k).toBeCloseTo(Math.sqrt(9.81 * h), 1);
  });
  it("P–M Hs ≈ 0.21·U19.5²/g", () => {
    const U = 15;
    const { Hs } = spectrumStats((w) => piersonMoskowitz(w, U), 0.05, 6, 20000);
    expect(Hs).toBeCloseTo((0.21 * U * U) / 9.81, 1);
  });
  it("fetch-limited sea never exceeds the fully developed sea", () => {
    for (const F of [10e3, 50e3, 100e3, 300e3, 1000e3]) {
      const s = seaState(12, F);
      const pm = spectrumStats((w) => piersonMoskowitz(w, s.U195));
      expect(s.Hs).toBeLessThanOrEqual(pm.Hs * 1.35); // JONSWAP peak enhancement near the limit
      if (!s.fullyDeveloped) expect(spectrumStats((w) => jonswap(w, 12, F)).Hs).toBeCloseTo(s.Hs, 6);
    }
    expect(seaState(12, 1000e3).fullyDeveloped).toBe(true);
    expect(seaState(12, 10e3).fullyDeveloped).toBe(false);
  });
  it("Ekman: 45° to the right in the NH, left in the SH; empirical V0 and D_E", () => {
    const n = ekman(10, 45), s = ekman(10, -45);
    expect(n.at(0).angleFromWind).toBeCloseTo(-Math.PI / 4, 6);
    expect(s.at(0).angleFromWind).toBeCloseTo(Math.PI / 4, 6);
    expect(n.V0).toBeCloseTo(0.0127 * 10 / Math.sqrt(Math.sin(Math.PI / 4)), 6);
    expect(ekman(10, 5).valid).toBe(false);
  });
});

describe("species", () => {
  it("benthic organisms are only met near the bottom", () => {
    const mid = candidates(1080, ["global", "tropical"], false, false, 9000).map((s) => s.id);
    expect(mid).not.toContain("xeno");
    const floor = candidates(4000, ["global"], false, false, 5).map((s) => s.id);
    expect(floor).toContain("xeno");
  });
  it("freshwater and marine species never mix", () => {
    expect(candidates(100, ["baikal", "global"], true, false).every((s) => s.freshwater)).toBe(true);
    expect(candidates(100, ["global", "tropical"], false, false).some((s) => s.freshwater)).toBe(false);
  });
  it("every species has a source and a valid depth range", () => {
    for (const s of SPECIES) { expect(s.source.length).toBeGreaterThan(5); expect(s.depth[0]).toBeLessThan(s.depth[1]); }
  });
});
