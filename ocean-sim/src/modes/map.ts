import { bathyGrid, bathySource, elevationAt, loadBathy } from "../data/bathy";
import { MISSIONS, type Mission } from "../data/missions";
import { columnAt, loadFallback, type Column } from "../data/profile";
import { VEHICLES } from "../sim/vehicles";
import { L, tr, trList } from "../i18n";
import type { DiveSetup } from "./dive";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Pick = { kind: "mission"; mission: Mission } | { kind: "point"; lat: number; lon: number };

export class MapMode {
  private pick: Pick = { kind: "mission", mission: MISSIONS[0] };
  private landImage: ImageData | null = null;

  constructor(private onStart: (s: DiveSetup) => void) {
    const canvas = $<HTMLCanvasElement>("map");
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const lon = ((e.clientX - r.left) / r.width) * 360 - 180;
      const lat = 90 - ((e.clientY - r.top) / r.height) * 180;
      this.pick = { kind: "point", lat, lon };
      this.render();
    });
    window.addEventListener("resize", () => this.draw());
    $("start").addEventListener("click", () => this.start());
    $<HTMLSelectElement>("vehicle").addEventListener("change", () => this.renderVehicleNotes());
    loadBathy().then(() => { this.landImage = null; this.render(); });
    this.render();
  }

  render() {
    const vs = $<HTMLSelectElement>("vehicle");
    const cur = vs.value || (this.pick.kind === "mission" ? this.pick.mission.vehicle : "alvin");
    vs.innerHTML = VEHICLES.map((v) => `<option value="${v.id}">${L(v.name)} — ${v.ratedDepth} m</option>`).join("");
    vs.value = cur;
    const ms = $<HTMLSelectElement>("month");
    const mcur = ms.value || "0";
    ms.innerHTML = trList("months").map((m, i) => `<option value="${i}">${m}</option>`).join("");
    ms.value = mcur;
    $("missions").innerHTML = "";
    for (const m of MISSIONS) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.innerHTML = `${L(m.name)}<small>${m.bottom} m · ${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}</small>`;
      if (this.pick.kind === "mission" && this.pick.mission.id === m.id) b.classList.add("active");
      b.addEventListener("click", () => { this.pick = { kind: "mission", mission: m }; vs.value = m.vehicle; this.render(); });
      li.appendChild(b);
      $("missions").appendChild(li);
    }
    this.renderVehicleNotes();
    this.renderPick();
    $("map-hint").textContent = tr("mapHint") + (bathySource() ? ` · ${bathySource()}` : ` · ${tr("noBathy")}`);
    this.draw();
  }

  private renderVehicleNotes() {
    const v = VEHICLES.find((x) => x.id === $<HTMLSelectElement>("vehicle").value);
    $("vehicle-notes").textContent = v ? `${L(v.notes)} (${v.sources.join("; ")})` : "";
  }

  private pointBottom(lat: number, lon: number): number | null {
    const e = elevationAt(lat, lon);
    if (e == null) return 4000;
    return e < 0 ? -e : null;
  }

  private renderPick() {
    const el = $("pick");
    if (this.pick.kind === "mission") {
      const m = this.pick.mission;
      el.innerHTML = `<b>${L(m.name)}</b><p>${L(m.brief)}</p><b>${tr("goals")}</b><ul>${L(m.goals).map((g) => `<li>${g}</li>`).join("")}</ul><small>${m.source}</small>`;
    } else {
      const { lat, lon } = this.pick;
      const b = this.pointBottom(lat, lon);
      el.innerHTML = `<b>${tr("freeDive")}</b><p>${lat.toFixed(2)}, ${lon.toFixed(2)} · ${b == null ? (L({ ru: "суша", en: "land" })) : `${tr("bottom")} ${b.toFixed(0)} m`}</p>`;
    }
  }

  private draw() {
    const canvas = $<HTMLCanvasElement>("map");
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w) return;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const g = bathyGrid();
    if (g) {
      if (!this.landImage || this.landImage.width !== w) {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const lat = 90 - ((y + 0.5) / h) * 180, lon = ((x + 0.5) / w) * 360 - 180;
          const e = elevationAt(lat, lon) ?? 0;
          const k = (y * w + x) * 4;
          if (e >= 0) { img.data[k] = 58; img.data[k + 1] = 62; img.data[k + 2] = 56; }
          else {
            // sequential blue: light = shallow, dark = deep (0…11 km)
            const f = Math.min(1, -e / 7000);
            img.data[k] = 205 - 192 * f; img.data[k + 1] = 226 - 172 * f; img.data[k + 2] = 251 - 144 * f;
          }
          img.data[k + 3] = 255;
        }
        this.landImage = img;
      }
      ctx.putImageData(this.landImage, 0, 0);
    } else {
      ctx.fillStyle = "#101c27"; ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    for (let lon = -180; lon <= 180; lon += 30) { const x = ((lon + 180) / 360) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { const y = ((90 - lat) / 180) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const P = (lat: number, lon: number) => [((lon + 180) / 360) * w, ((90 - lat) / 180) * h];
    ctx.font = "12px system-ui, sans-serif";
    for (const m of MISSIONS) {
      const [x, y] = P(m.lat, m.lon);
      const sel = this.pick.kind === "mission" && this.pick.mission.id === m.id;
      ctx.fillStyle = sel ? "#eda100" : "#ffffff";
      ctx.strokeStyle = "#0a1016"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, sel ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f2f5f7";
      ctx.fillText(L(m.name).split(",")[0], x + 8, y + 4);
    }
    if (this.pick.kind === "point") {
      const [x, y] = P(this.pick.lat, this.pick.lon);
      ctx.strokeStyle = "#eda100"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
    }
  }

  private async start() {
    const vehicleId = $<HTMLSelectElement>("vehicle").value;
    let column: Column, lat: number, lon: number, bottom: number, chl: number, missionId: string | undefined, label: string;
    if (this.pick.kind === "mission") {
      const m = this.pick.mission;
      ({ lat, lon, bottom, chl } = m);
      missionId = m.id;
      label = L(m.name);
      const fb = await loadFallback();
      // Prefer WOA23 for ocean missions once prepared; lakes are not in WOA.
      const month = +$<HTMLSelectElement>("month").value;
      const woa = m.id === "baikal" ? null : await columnAt(lat, lon, month);
      column = woa && woa.source.startsWith("WOA23") ? woa : fb.missions[m.id];
    } else {
      ({ lat, lon } = this.pick);
      const b = this.pointBottom(lat, lon);
      if (b == null) return;
      bottom = Math.max(b, 20);
      chl = Math.abs(lat) > 45 ? 0.6 : Math.abs(lat) < 15 ? 0.15 : 0.1;
      column = await columnAt(lat, lon, +$<HTMLSelectElement>("month").value);
      label = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    }
    this.onStart({ lat, lon, bottom, chl, missionId, vehicleId, column, wind: 8, label });
  }
}
