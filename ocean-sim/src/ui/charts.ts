/**
 * Minimal canvas charts: depth profiles (small multiples, one measure each,
 * one axis), a T-S diagram with σ₀ isopycnals, and a light spectrum.
 * Colours come from CSS tokens so the dark UI stays consistent.
 */
import * as t10 from "../science/teos10";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

function setup(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px system-ui, sans-serif";
  return { ctx, w, h };
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-2 || a >= 1e5)) return v.toExponential(1);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
};

export interface ProfileSpec {
  title: string;
  unit: string;
  /** Full column: [z, value] pairs (context, muted). */
  column: Array<[number, number]>;
  /** Measured trace along the dive. */
  trace: Array<[number, number]>;
  currentZ: number;
  maxZ: number;
  hoverZ?: number | null;
}

export function drawProfile(canvas: HTMLCanvasElement, s: ProfileSpec) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 34, r: 8, t: 18, b: 18 };
  const vals = [...s.column.map((p) => p[1]), ...s.trace.map((p) => p[1])].filter(Number.isFinite);
  if (!vals.length) return;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const m = (hi - lo) * 0.06; lo -= m; hi += m;
  const X = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (w - pad.l - pad.r);
  const Y = (z: number) => pad.t + (z / s.maxZ) * (h - pad.t - pad.b);

  ctx.fillStyle = css("--text-secondary");
  ctx.fillText(`${s.title}, ${s.unit}`, pad.l, 12);
  // grid
  ctx.strokeStyle = css("--grid");
  ctx.lineWidth = 1;
  ctx.fillStyle = css("--text-muted");
  for (const v of niceTicks(lo, hi, 3)) {
    ctx.beginPath(); ctx.moveTo(X(v), pad.t); ctx.lineTo(X(v), h - pad.b); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillText(fmt(v), X(v), h - 5);
  }
  ctx.textAlign = "right";
  for (const z of niceTicks(0, s.maxZ, 4)) ctx.fillText(z >= 1000 ? `${z / 1000}k` : `${z}`, pad.l - 4, Y(z) + 4);
  ctx.textAlign = "left";

  const line = (pts: Array<[number, number]>, color: string, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (const [z, v] of pts) {
      if (!Number.isFinite(v)) { started = false; continue; }
      if (!started) { ctx.moveTo(X(v), Y(z)); started = true; } else ctx.lineTo(X(v), Y(z));
    }
    ctx.stroke();
  };
  line(s.column, css("--context-line"), 1.5);
  line(s.trace, css("--series-1"), 2);

  // current depth
  ctx.strokeStyle = css("--accent");
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(pad.l, Y(s.currentZ)); ctx.lineTo(w - pad.r, Y(s.currentZ)); ctx.stroke();
  ctx.setLineDash([]);

  if (s.hoverZ != null && s.column.length) {
    // nearest column value at hovered depth
    let best = s.column[0];
    for (const p of s.column) if (Math.abs(p[0] - s.hoverZ) < Math.abs(best[0] - s.hoverZ)) best = p;
    const x = X(best[1]), y = Y(best[0]);
    ctx.strokeStyle = css("--text-muted");
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = css("--series-1");
    ctx.strokeStyle = css("--surface-1");
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const label = `${best[0].toFixed(0)} m: ${fmt(best[1])}`;
    const tw = ctx.measureText(label).width + 10;
    const tx = Math.min(Math.max(x - tw / 2, 2), w - tw - 2);
    const ty = y > h / 2 ? y - 24 : y + 8;
    ctx.fillStyle = css("--tooltip-bg");
    ctx.fillRect(tx, ty, tw, 17);
    ctx.fillStyle = css("--text-primary");
    ctx.fillText(label, tx + 5, ty + 12);
  }
}

/** Depth under the pointer for a profile canvas (same geometry as drawProfile). */
export function hoverDepth(canvas: HTMLCanvasElement, ev: MouseEvent, maxZ: number): number | null {
  const r = canvas.getBoundingClientRect();
  const y = ev.clientY - r.top;
  const t = 18, b = 18;
  if (y < t || y > r.height - b) return null;
  return ((y - t) / (r.height - t - b)) * maxZ;
}

export interface TSPoint { SA: number; CT: number; z: number }

export function drawTS(canvas: HTMLCanvasElement, column: TSPoint[], trace: TSPoint[], maxZ: number, labels: { x: string; y: string }, hover?: { x: number; y: number } | null) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 36, r: 10, t: 12, b: 26 };
  const all = [...column, ...trace];
  if (!all.length) return;
  let sLo = Math.min(...all.map((p) => p.SA)), sHi = Math.max(...all.map((p) => p.SA));
  let tLo = Math.min(...all.map((p) => p.CT)), tHi = Math.max(...all.map((p) => p.CT));
  const ms = Math.max((sHi - sLo) * 0.1, 0.05), mt = Math.max((tHi - tLo) * 0.08, 0.2);
  sLo -= ms; sHi += ms; tLo -= mt; tHi += mt;
  const X = (s: number) => pad.l + ((s - sLo) / (sHi - sLo)) * (w - pad.l - pad.r);
  const Y = (t: number) => h - pad.b - ((t - tLo) / (tHi - tLo)) * (h - pad.t - pad.b);

  // σ₀ isopycnals: for each level solve CT(SA) by bisection
  const sigLo = t10.sigma0(sLo, tHi), sigHi = t10.sigma0(sHi, tLo);
  ctx.lineWidth = 1;
  ctx.font = "10px system-ui, sans-serif";
  for (const sig of niceTicks(sigLo, sigHi, 6)) {
    ctx.strokeStyle = css("--grid-strong");
    ctx.beginPath();
    let started = false, lastX = 0, lastY = 0;
    for (let i = 0; i <= 60; i++) {
      const sa = sLo + ((sHi - sLo) * i) / 60;
      let a = tLo - 5, b = tHi + 5;
      if ((t10.sigma0(sa, a) - sig) * (t10.sigma0(sa, b) - sig) > 0) { started = false; continue; }
      for (let k = 0; k < 40; k++) {
        const mid = (a + b) / 2;
        if (t10.sigma0(sa, mid) > sig) a = mid; else b = mid;
      }
      const ct = (a + b) / 2;
      if (ct < tLo || ct > tHi) { started = false; continue; }
      if (!started) { ctx.moveTo(X(sa), Y(ct)); started = true; } else ctx.lineTo(X(sa), Y(ct));
      lastX = X(sa); lastY = Y(ct);
    }
    ctx.stroke();
    if (lastX) { ctx.fillStyle = css("--text-muted"); ctx.fillText(sig.toFixed(1), Math.min(lastX + 2, w - 28), Math.max(lastY, 20)); }
  }
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = css("--text-muted");
  ctx.textAlign = "center";
  for (const s of niceTicks(sLo, sHi, 4)) ctx.fillText(fmt(s), X(s), h - 12);
  ctx.fillText(labels.x, (pad.l + w) / 2, h - 1);
  ctx.textAlign = "right";
  for (const t of niceTicks(tLo, tHi, 4)) ctx.fillText(fmt(t), pad.l - 4, Y(t) + 4);
  ctx.save(); ctx.translate(10, h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText(labels.y, 0, 0); ctx.restore();
  ctx.textAlign = "left";

  // column in muted, trace coloured by depth (sequential blue ramp, light = shallow)
  ctx.strokeStyle = css("--context-line"); ctx.lineWidth = 1.5;
  ctx.beginPath(); column.forEach((p, i) => (i ? ctx.lineTo(X(p.SA), Y(p.CT)) : ctx.moveTo(X(p.SA), Y(p.CT)))); ctx.stroke();
  const ramp = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  for (const p of trace) {
    const i = Math.min(ramp.length - 1, Math.floor((p.z / Math.max(maxZ, 1)) * ramp.length));
    ctx.fillStyle = ramp[i];
    ctx.beginPath(); ctx.arc(X(p.SA), Y(p.CT), 2.5, 0, Math.PI * 2); ctx.fill();
  }
  if (hover) {
    let best: TSPoint | null = null, bd = 144;
    for (const p of [...trace, ...column]) {
      const d = (X(p.SA) - hover.x) ** 2 + (Y(p.CT) - hover.y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      const label = `${best.z.toFixed(0)} m · SA ${best.SA.toFixed(3)} · Θ ${best.CT.toFixed(2)} · σ₀ ${t10.sigma0(best.SA, best.CT).toFixed(2)}`;
      const tw = ctx.measureText(label).width + 10;
      const tx = Math.min(Math.max(X(best.SA) - tw / 2, 2), w - tw - 2);
      ctx.fillStyle = css("--tooltip-bg"); ctx.fillRect(tx, 2, tw, 17);
      ctx.fillStyle = css("--text-primary"); ctx.fillText(label, tx + 5, 14);
      ctx.strokeStyle = css("--text-primary"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(best.SA), Y(best.CT), 5, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

/** Approximate visible colour of a wavelength, for the spectrum bars only. */
export function wavelengthColour(l: number): string {
  let r = 0, g = 0, b = 0;
  if (l < 440) { r = (440 - l) / 60; b = 1; }
  else if (l < 490) { g = (l - 440) / 50; b = 1; }
  else if (l < 510) { g = 1; b = (510 - l) / 20; }
  else if (l < 580) { r = (l - 510) / 70; g = 1; }
  else if (l < 645) { r = 1; g = (645 - l) / 65; }
  else r = 1;
  const f = l < 420 ? 0.3 + (0.7 * (l - 380)) / 40 : l > 680 ? 0.3 + (0.7 * (700 - l)) / 20 : 1;
  const c = (v: number) => Math.round(255 * Math.pow(v * f, 0.8));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

/** Spectrum on a log axis (orders of magnitude below surface). */
export function drawSpectrum(canvas: HTMLCanvasElement, wl: number[], rel: number[], ylabel: string) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 36, r: 8, t: 10, b: 22 };
  const floor = -12;
  const Y = (v: number) => {
    const lv = Math.max(Math.log10(Math.max(v, 1e-300)), floor);
    return pad.t + ((0 - lv) / (0 - floor)) * (h - pad.t - pad.b);
  };
  const bw = (w - pad.l - pad.r) / wl.length;
  ctx.fillStyle = css("--text-muted");
  ctx.textAlign = "right";
  for (const e of [0, -3, -6, -9, -12]) {
    const y = Y(Math.pow(10, e));
    ctx.strokeStyle = css("--grid"); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(`10^${e}`, pad.l - 4, y + 4);
  }
  wl.forEach((l, i) => {
    const y = Y(rel[i]);
    ctx.fillStyle = wavelengthColour(l);
    ctx.fillRect(pad.l + i * bw + 1, y, bw - 2, h - pad.b - y);
  });
  ctx.fillStyle = css("--text-muted");
  ctx.textAlign = "center";
  for (const l of [400, 500, 600, 700]) ctx.fillText(`${l}`, pad.l + ((l - wl[0]) / (wl[wl.length - 1] - wl[0] + 10)) * (w - pad.l - pad.r) + bw / 2, h - 6);
  ctx.textAlign = "left";
  ctx.fillText(ylabel, pad.l + 4, pad.t + 10);
}

export function drawLine(canvas: HTMLCanvasElement, xs: number[], ys: number[], xlabel: string, ylabel: string, marker?: number) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 44, r: 10, t: 12, b: 26 };
  const xLo = Math.min(...xs), xHi = Math.max(...xs);
  const yHi = Math.max(...ys) * 1.08 || 1;
  const X = (v: number) => pad.l + ((v - xLo) / (xHi - xLo)) * (w - pad.l - pad.r);
  const Y = (v: number) => h - pad.b - (v / yHi) * (h - pad.t - pad.b);
  ctx.fillStyle = css("--text-muted");
  ctx.textAlign = "center";
  for (const v of niceTicks(xLo, xHi, 5)) {
    ctx.strokeStyle = css("--grid"); ctx.beginPath(); ctx.moveTo(X(v), pad.t); ctx.lineTo(X(v), h - pad.b); ctx.stroke();
    ctx.fillText(fmt(v), X(v), h - 12);
  }
  ctx.fillText(xlabel, (pad.l + w) / 2, h - 1);
  ctx.textAlign = "right";
  for (const v of niceTicks(0, yHi, 3)) ctx.fillText(fmt(v), pad.l - 4, Y(v) + 4);
  ctx.textAlign = "left";
  ctx.fillText(ylabel, pad.l + 4, pad.t + 8);
  ctx.strokeStyle = css("--series-1"); ctx.lineWidth = 2;
  ctx.beginPath(); xs.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(ys[i])) : ctx.moveTo(X(x), Y(ys[i])))); ctx.stroke();
  if (marker != null) {
    ctx.strokeStyle = css("--accent"); ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(marker), pad.t); ctx.lineTo(X(marker), h - pad.b); ctx.stroke(); ctx.setLineDash([]);
  }
}
