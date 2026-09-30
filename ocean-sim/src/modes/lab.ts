import * as t10 from "../science/teos10";
import { euphoticDepth, euphoticDepthMorel, irradianceSpectrum, kd490, kdPAR, parFraction, WAVELENGTHS } from "../science/optics";
import { coriolis, dragCoefficient, ekman, piersonMoskowitz, seaState, spectrumStats, windStress } from "../science/waves";
import { drawLine, drawSpectrum } from "../ui/charts";
import { tr } from "../i18n";
import { openFormula } from "./dive";

interface Slider { id: string; label: string; min: number; max: number; step: number; value: number; unit: string }

function card(title: string, sliders: Slider[], extra = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<h2>${title}</h2>` +
    sliders.map((s) => `<label>${s.label}<input type="range" id="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"><output id="${s.id}-o"></output></label>`).join("") +
    extra;
  return el;
}

const num = (id: string) => +(document.getElementById(id) as HTMLInputElement).value;
const out = (id: string, v: string) => ((document.getElementById(`${id}-o`) as HTMLOutputElement).textContent = v);

export class LabMode {
  private root = document.getElementById("lab")!;
  constructor() { this.build(); }

  refreshLang() { this.build(); }

  build() {
    const keep: Record<string, string> = {};
    this.root.querySelectorAll("input").forEach((i) => (keep[i.id] = i.value));
    this.root.innerHTML = "";
    this.root.append(
      card(tr("labSeawater"), [
        { id: "l-sa", label: "SA", min: 0, max: 42, step: 0.01, value: 35.165, unit: "g/kg" },
        { id: "l-ct", label: "Θ", min: -2, max: 35, step: 0.01, value: 10, unit: "°C" },
        { id: "l-p", label: "p", min: 0, max: 11000, step: 10, value: 1000, unit: "dbar" },
      ], `<table id="l-sw"></table>`),
      card(tr("labWaves"), [
        { id: "l-u", label: tr("wind"), min: 2, max: 30, step: 0.5, value: 12, unit: "m/s" },
        { id: "l-f", label: tr("fetch"), min: 10, max: 1000, step: 10, value: 100, unit: "km" },
        { id: "l-lat", label: tr("latitude"), min: -80, max: 80, step: 1, value: 45, unit: "°" },
      ], `<table id="l-wv"></table><canvas id="l-wv-c"></canvas><p class="warn" id="l-ek-warn"></p>`),
      card(tr("labLight"), [
        { id: "l-chl", label: "Chl-a", min: 0.02, max: 10, step: 0.01, value: 0.2, unit: "mg/m³" },
        { id: "l-z", label: tr("depth"), min: 0, max: 500, step: 1, value: 50, unit: "m" },
      ], `<table id="l-lt"></table><canvas id="l-lt-c"></canvas>`),
    );
    Object.entries(keep).forEach(([id, v]) => { const i = document.getElementById(id) as HTMLInputElement | null; if (i) i.value = v; });
    this.root.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => this.update()));
    this.update();
  }

  private table(id: string, rows: Array<[string, string, string?]>) {
    const t = document.getElementById(id)!;
    t.innerHTML = "";
    for (const [k, v, f] of rows) {
      const tr_ = document.createElement("tr");
      tr_.innerHTML = `<td>${k}${f ? ' <span class="f" style="color:var(--series-1)">ƒ</span>' : ""}</td><td>${v}</td>`;
      if (f) { tr_.style.cursor = "help"; tr_.addEventListener("click", () => openFormula(k, f)); }
      t.appendChild(tr_);
    }
  }

  update() {
    // Seawater
    const SA = num("l-sa"), CT = num("l-ct"), p = num("l-p");
    out("l-sa", `${SA.toFixed(3)} g/kg`); out("l-ct", `${CT.toFixed(2)} °C`); out("l-p", `${p.toFixed(0)} dbar`);
    const frz = t10.ctFreezing(SA, p);
    this.table("l-sw", [
      [tr("depth") + " (φ=45°)", `${(-t10.zFromP(p, 45)).toFixed(1)} m`, "pressure"],
      [tr("rho"), `${t10.rho(SA, CT, p).toFixed(4)} kg/m³`, "rho"],
      [tr("sigma0"), `${t10.sigma0(SA, CT).toFixed(4)} kg/m³`, "sigma0"],
      ["α", `${(t10.alpha(SA, CT, p) * 1e4).toFixed(3)}·10⁻⁴ K⁻¹`],
      ["β", `${(t10.beta(SA, CT, p) * 1e4).toFixed(3)}·10⁻⁴ kg/g`],
      [tr("soundSpeed"), `${t10.soundSpeed(SA, CT, p).toFixed(3)} m/s`, "soundSpeed"],
      ["Θ_freezing", `${frz.toFixed(3)} °C${CT < frz ? " ⚠" : ""}`],
    ]);

    // Waves
    const U = num("l-u"), F = num("l-f") * 1000, lat = num("l-lat");
    out("l-u", `${U} m/s`); out("l-f", `${(F / 1000).toFixed(0)} km`); out("l-lat", `${lat}°`);
    const sj = seaState(U, F);
    const J = sj.S;
    const sp = spectrumStats((w: number) => piersonMoskowitz(w, sj.U195));
    const regime = sj.fullyDeveloped ? "P–M, fully developed" : "JONSWAP, fetch-limited";
    const ek = ekman(U, lat);
    this.table("l-wv", [
      [`${tr("Hs")} (${regime})`, `${sj.Hs.toFixed(2)} m`],
      [`${tr("Tp")}`, `${sj.Tp.toFixed(1)} s`],
      [`${tr("Hs")} (P–M limit)`, `${sp.Hs.toFixed(2)} m`],
      ["τ = ρₐ C_D U²", `${windStress(U).toFixed(3)} N/m² (C_D ${(dragCoefficient(U) * 1e3).toFixed(2)}·10⁻³)`],
      ["f = 2Ω sin φ", `${coriolis(lat).toExponential(3)} s⁻¹`],
      [tr("ekmanV0"), `${ek.V0.toFixed(3)} m/s`],
      [tr("ekmanDepth"), `${ek.DE.toFixed(0)} m`],
    ]);
    document.getElementById("l-ek-warn")!.textContent = ek.valid ? "" : tr("ekmanInvalid");
    const ws = Array.from({ length: 200 }, (_, i) => 0.2 + (i * 2.3) / 200);
    drawLine(document.getElementById("l-wv-c") as HTMLCanvasElement, ws, ws.map(J), "ω, rad/s", `S(ω), m²·s (${regime})`, sj.peakOmega);

    // Light
    const chl = num("l-chl"), z = num("l-z");
    out("l-chl", `${chl.toFixed(2)} mg/m³`); out("l-z", `${z} m`);
    this.table("l-lt", [
      ["K_d(490)", `${kd490(chl).toFixed(4)} m⁻¹`, "light"],
      ["K_d(PAR)", `${kdPAR(chl).toFixed(4)} m⁻¹`, "light"],
      [`${tr("zeu")}, spectral`, `${euphoticDepth(chl).toFixed(1)} m`, "light"],
      ["4.6 / K_d(PAR) (Morel 2007)", `${euphoticDepthMorel(chl).toFixed(1)} m`, "light"],
      [`PAR(${z} m)/PAR(0)`, parFraction(z, chl).toExponential(3), "light"],
    ]);
    const E = irradianceSpectrum(z, chl), E0 = irradianceSpectrum(0, chl);
    drawSpectrum(document.getElementById("l-lt-c") as HTMLCanvasElement, WAVELENGTHS, E.map((v, i) => v / E0[i]), `Ed(λ, ${z} m) / Ed(λ, 0)`);
  }
}
