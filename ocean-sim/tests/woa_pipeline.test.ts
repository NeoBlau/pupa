import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeTile } from "../src/data/profile";

// Tile produced by tools/prepare_woa.py from tools/make_synthetic_woa.py input.
const dir = new URL("./fixtures/woa_synthetic/", import.meta.url);
const idx = JSON.parse(readFileSync(new URL("index.json", dir), "utf8"));
const expected = JSON.parse(readFileSync(new URL("expect.json", dir), "utf8"));
const buf = readFileSync(new URL("10_140.bin", dir));
const cells = decodeTile(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), idx);

describe("WOA23 tile pipeline (synthetic input)", () => {
  it("decodes every cell of the tile", () => {
    expect(cells.length).toBe(100);
  });
  it("SA and CT at 1000 m equal gsw conversion to quantisation precision", () => {
    const c = cells.find((x) => x.ci === 1 && x.cj === 2)!; // 11.5°N 142.5°E
    const k = idx.levels.indexOf(1000);
    expect(Math.abs(c.cols.SA[k] - expected.SA1000)).toBeLessThan(6e-4);
    expect(Math.abs(c.cols.CT[k] - expected.CT1000)).toBeLessThan(6e-4);
  });
  it("deep columns are extended to 11 000 m with exact adiabatic t", () => {
    const c = cells.find((x) => x.ci === 1 && x.cj === 2)!;
    expect(idx.levels[c.cols.t.length - 1]).toBe(11000);
    expect(Math.abs(c.cols.t[c.cols.t.length - 1] - expected.t11000)).toBeLessThan(6e-4);
  });
  it("shallower columns stop at their own bottom", () => {
    const c = cells.find((x) => x.ci === 6)!; // lat > 15 → 3000 m bottom
    expect(idx.levels[c.cols.SA.length - 1]).toBe(3000);
  });
});
