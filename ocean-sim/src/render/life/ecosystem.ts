/**
 * Marine life around the submersible: spawning by zone/depth/region, schooling
 * (boids: separation, alignment, cohesion), wandering, depth keeping, floor
 * and obstacle avoidance, reactions to the craft (flee from noise/approach,
 * light avoidance or attraction, curious circling), and animation.
 *
 * Depth ranges and regions follow the cited sources; behaviour parameters are
 * qualitative (cruise speeds from typical body-length-per-second values).
 */
import * as THREE from "three";
import { prefab, type Prefab } from "./assets";
import { addSwimBend, anglerfish, jellyfish, lanternfish, manta, moray, snailfish, type ProcInstance } from "./procedural";

export type Zone = "surface" | "shallow" | "reef" | "open" | "cave" | "wreck" | "deep" | "trench" | "floor";
export type LightResponse = "avoid" | "attract" | "neutral";

export interface Species3D {
  id: string;
  latin: string;
  name: { ru: string; en: string };
  depth: [number, number];
  zones: Zone[];
  /** Missions/regions where the species occurs; empty = any ocean. */
  where: string[];
  group: [number, number];
  cruise: number; // m/s
  length: number; // m
  light: LightResponse;
  flee: number; // m, flight distance
  bottom?: boolean;
  curious?: boolean;
  surfaceOK?: boolean;
  density: number; // relative abundance
  kind: "asset" | "procedural";
  source: string;
  fact: { ru: string; en: string };
}

const TROP_PAC = ["reef_guam", "challenger_deep", "tropical"];

export const SPECIES_3D: Species3D[] = [
  { id: "clownfish", latin: "Amphiprion sp.", name: { ru: "Рыба-клоун", en: "Clownfish" }, depth: [1, 15], zones: ["reef"], where: ["reef_guam"], group: [1, 2], cruise: 0.2, length: 0.09, light: "neutral", flee: 1.5, density: 3, kind: "asset",
    source: "FishBase: Amphiprion", fact: { ru: "Живёт в симбиозе с актиниями, слизь защищает её от их стрекательных клеток.", en: "Lives in symbiosis with sea anemones; its mucus protects it from their stinging cells." } },
  { id: "blue_tang", latin: "Paracanthurus hepatus", name: { ru: "Голубой хирург", en: "Palette surgeonfish" }, depth: [2, 40], zones: ["reef", "shallow"], where: ["reef_guam"], group: [1, 3], cruise: 0.35, length: 0.25, light: "neutral", flee: 3, density: 3, kind: "asset",
    source: "FishBase: Paracanthurus hepatus", fact: { ru: "У основания хвоста — острый «скальпель», отсюда название «хирург».", en: "A scalpel-like spine at the tail base gives surgeonfish their name." } },
  { id: "yellow_tang", latin: "Zebrasoma flavescens", name: { ru: "Жёлтый хирург", en: "Yellow tang" }, depth: [2, 46], zones: ["reef", "shallow"], where: ["reef_guam"], group: [1, 3], cruise: 0.3, length: 0.18, light: "neutral", flee: 3, density: 3, kind: "asset",
    source: "FishBase: Zebrasoma flavescens", fact: { ru: "Травоядна: объедает водоросли с кораллов и этим помогает рифу.", en: "Grazes algae off coral, helping keep the reef healthy." } },
  { id: "moorish_idol", latin: "Zanclus cornutus", name: { ru: "Мавританский идол", en: "Moorish idol" }, depth: [3, 180], zones: ["reef"], where: ["reef_guam"], group: [1, 2], cruise: 0.3, length: 0.2, light: "neutral", flee: 3, density: 2, kind: "asset",
    source: "FishBase: Zanclus cornutus", fact: { ru: "Единственный вид своего семейства; длинный спинной плавник тянется шлейфом.", en: "Sole member of its family; the dorsal fin trails like a pennant." } },
  { id: "snapper", latin: "Lutjanidae", name: { ru: "Луцианы (стая)", en: "Snappers (school)" }, depth: [0, 180], zones: ["reef", "shallow", "wreck"], where: ["reef_guam", "gulf_stream", "tropical"], group: [10, 24], cruise: 0.5, length: 0.45, light: "avoid", flee: 5, density: 2, kind: "asset",
    source: "FishBase: Lutjanidae", fact: { ru: "Днём держатся стаями у рифов и обломков судов, ночью охотятся поодиночке.", en: "School around reefs and wrecks by day, hunt alone at night." } },
  { id: "barramundi", latin: "Lates calcarifer", name: { ru: "Баррамунди", en: "Barramundi" }, depth: [0, 40], zones: ["shallow"], where: ["tropical"], group: [1, 3], cruise: 0.4, length: 0.8, light: "avoid", flee: 6, density: 1, kind: "asset",
    source: "FishBase: Lates calcarifer", fact: { ru: "Протандрический гермафродит: рождается самцом, с возрастом становится самкой.", en: "Protandrous hermaphrodite: starts life male, becomes female later." } },
  { id: "reef_shark", latin: "Carcharhinus amblyrhynchos", name: { ru: "Серая рифовая акула", en: "Grey reef shark" }, depth: [0, 280], zones: ["reef", "open", "shallow", "wreck"], where: ["reef_guam", "challenger_deep", "tropical"], group: [1, 2], cruise: 0.8, length: 1.7, light: "neutral", flee: 4, curious: true, density: 0.6, kind: "asset",
    source: "FishBase: Carcharhinus amblyrhynchos", fact: { ru: "Угрожая, выгибает спину и опускает грудные плавники — это предупреждение, а не атака.", en: "Threat display: arched back and lowered pectorals — a warning, not an attack." } },
  { id: "octopus", latin: "Octopus cyanea", name: { ru: "Дневной осьминог", en: "Day octopus" }, depth: [0, 150], zones: ["reef", "cave", "floor"], where: ["reef_guam"], group: [1, 1], cruise: 0.1, length: 0.5, light: "avoid", flee: 2.5, bottom: true, density: 1, kind: "asset",
    source: "SeaLifeBase: Octopus cyanea", fact: { ru: "Меняет цвет и фактуру кожи за доли секунды благодаря хроматофорам.", en: "Changes skin colour and texture in a fraction of a second using chromatophores." } },
  { id: "turtle", latin: "Lepidochelys kempii", name: { ru: "Черепаха Кемпа", en: "Kemp's ridley turtle" }, depth: [0, 50], zones: ["surface", "shallow", "open"], where: ["gulf_stream", "nw_atlantic"], group: [1, 1], cruise: 0.5, length: 0.65, light: "neutral", flee: 4, surfaceOK: true, density: 1, kind: "asset",
    source: "NOAA Fisheries: Kemp's ridley; model CC-BY-NC DigitalLife3D", fact: { ru: "Самая редкая морская черепаха; молодь дрейфует с Гольфстримом в саргассовых полях.", en: "The rarest sea turtle; juveniles drift with the Gulf Stream in sargassum." } },
  { id: "crab", latin: "Brachyura", name: { ru: "Краб", en: "Crab" }, depth: [0, 200], zones: ["floor", "reef", "wreck"], where: [], group: [1, 3], cruise: 0.05, length: 0.18, light: "avoid", flee: 1.5, bottom: true, density: 2, kind: "asset",
    source: "3D scan: threedscans.com", fact: { ru: "Ходит боком: суставы ног сгибаются вбок, так быстрее.", en: "Walks sideways: its leg joints bend laterally, which is faster." } },
  { id: "elbow_crab", latin: "Parthenopidae", name: { ru: "Краб-локоть", en: "Elbow crab" }, depth: [2, 100], zones: ["floor", "reef"], where: ["reef_guam"], group: [1, 1], cruise: 0.03, length: 0.12, light: "avoid", flee: 1, bottom: true, density: 1, kind: "asset",
    source: "3D scan: threedscans.com; WoRMS Parthenopidae", fact: { ru: "Непропорционально длинные клешни, похожие на согнутые локти.", en: "Disproportionately long claws that look like bent elbows." } },
  { id: "aurelia", latin: "Aurelia aurita", name: { ru: "Ушастая медуза", en: "Moon jellyfish" }, depth: [0, 200], zones: ["surface", "shallow", "open"], where: [], group: [2, 8], cruise: 0.05, length: 0.25, light: "neutral", flee: 0, surfaceOK: true, density: 1.5, kind: "procedural",
    source: "WoRMS: Aurelia aurita", fact: { ru: "Четыре кольца в куполе — гонады. Тело на 95 % состоит из воды.", en: "The four rings in the bell are gonads; the body is 95 % water." } },
  { id: "manta", latin: "Mobula birostris", name: { ru: "Гигантская манта", en: "Giant manta" }, depth: [0, 1000], zones: ["surface", "open", "reef"], where: TROP_PAC, group: [1, 1], cruise: 0.8, length: 4.5, light: "neutral", flee: 6, curious: true, surfaceOK: true, density: 0.3, kind: "procedural",
    source: "Marshall A. et al. (2009) Zootaxa 2301", fact: { ru: "Размах плавников до 7 м; по пятнам на брюхе особей различают, как по отпечаткам пальцев.", en: "Up to 7 m across; individuals are identified by belly spot patterns like fingerprints." } },
  { id: "moray", latin: "Gymnothorax javanicus", name: { ru: "Гигантская мурена", en: "Giant moray" }, depth: [0, 50], zones: ["reef", "cave", "wreck"], where: ["reef_guam"], group: [1, 1], cruise: 0.2, length: 1.8, light: "avoid", flee: 2, bottom: true, density: 0.8, kind: "procedural",
    source: "FishBase: Gymnothorax javanicus", fact: { ru: "Вторые, глоточные челюсти выдвигаются вперёд и затягивают добычу.", en: "A second, pharyngeal jaw shoots forward to drag prey in." } },
  { id: "lanternfish", latin: "Myctophidae", name: { ru: "Светящиеся анчоусы", en: "Lanternfishes" }, depth: [300, 1200], zones: ["open", "deep"], where: [], group: [15, 40], cruise: 0.25, length: 0.08, light: "attract", flee: 2, density: 2, kind: "procedural",
    source: "Catul V. et al. (2011) Rev. Fish Biol. Fish. 21", fact: { ru: "Фотофоры на брюхе маскируют силуэт на фоне света сверху (контрасвечение).", en: "Belly photophores hide the silhouette against light from above (counter-illumination)." } },
  { id: "atolla", latin: "Atolla wyvillei", name: { ru: "Медуза атолла", en: "Atolla jellyfish" }, depth: [500, 4000], zones: ["deep", "open"], where: [], group: [1, 1], cruise: 0.03, length: 0.15, light: "neutral", flee: 0, density: 0.8, kind: "procedural",
    source: "Widder E.A. (2010) Science 328", fact: { ru: "При нападении вспыхивает синим «сигналом тревоги», привлекая более крупного хищника.", en: "When attacked it flashes a blue 'burglar alarm' that attracts bigger predators." } },
  { id: "angler", latin: "Melanocetus johnsonii", name: { ru: "Удильщик Джонсона", en: "Humpback anglerfish" }, depth: [200, 2000], zones: ["deep"], where: [], group: [1, 1], cruise: 0.05, length: 0.18, light: "neutral", flee: 1, density: 0.4, kind: "procedural",
    source: "FishBase: Melanocetus johnsonii", fact: { ru: "Свет в эске дают симбиотические бактерии.", en: "The lure's light comes from symbiotic bacteria." } },
  { id: "snailfish", latin: "Pseudoliparis swirei", name: { ru: "Марианский липарис", en: "Mariana snailfish" }, depth: [6198, 8078], zones: ["trench", "floor"], where: ["challenger_deep"], group: [1, 3], cruise: 0.05, length: 0.25, light: "attract", flee: 1, bottom: true, density: 2, kind: "procedural",
    source: "Gerringer M.E. et al. (2017) Zootaxa 4358", fact: { ru: "Предел около 8200 м задаёт осмолит TMAO, стабилизирующий белки под давлением.", en: "The ~8200 m limit is set by TMAO, an osmolyte that stabilises proteins under pressure." } },
];

interface Agent {
  sp: Species3D;
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  tick: ((dt: number, s: number) => void) | null;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  wander: THREE.Vector3;
  groupId: number;
  prefDepth: number;
  alarmed: number;
  scanned?: boolean;
}

export interface WorldQuery {
  /** Seafloor depth [m] at three (x, z). */
  floor: (x: number, z: number) => number;
  obstacles: Array<{ pos: THREE.Vector3; r: number }>;
  missionId?: string;
  regionTags: string[];
}

export interface CraftInfo { pos: THREE.Vector3; vel: THREE.Vector3; forward: THREE.Vector3; lightsOn: boolean; noise: number }

const REEF_MESHES: Record<string, number> = { clownfish: 0, blue_tang: 1, yellow_tang: 2, moorish_idol: 3 };

export class Ecosystem {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private prefabs = new Map<string, Promise<Prefab | null>>();
  private nextGroup = 1;
  private spawnTimer = 0;
  private pending = 0;
  readonly radius = 90;
  /** Callback when a creature reacts strongly (for rumble/log). */
  onAlarm: ((sp: Species3D) => void) | null = null;

  constructor(private world: WorldQuery) {}

  private getPrefab(sp: Species3D): Promise<Prefab | null> {
    if (sp.kind !== "asset") return Promise.resolve(null);
    if (!this.prefabs.has(sp.id)) {
      const map: Record<string, () => Promise<Prefab>> = {
        clownfish: () => prefab("reef_fish", { meshIndex: REEF_MESHES.clownfish, length: sp.length * 3 }),
        blue_tang: () => prefab("reef_fish", { meshIndex: REEF_MESHES.blue_tang, length: sp.length * 3 }),
        yellow_tang: () => prefab("reef_fish", { meshIndex: REEF_MESHES.yellow_tang, length: sp.length * 3 }),
        moorish_idol: () => prefab("reef_fish", { meshIndex: REEF_MESHES.moorish_idol, length: sp.length * 3 }),
        snapper: () => prefab("grey_snapper", { length: sp.length }),
        barramundi: () => prefab("barramundi", { length: sp.length }),
        reef_shark: () => prefab("shark", { length: sp.length }),
        octopus: () => prefab("octopus", { length: sp.length }),
        turtle: () => prefab("turtle", { length: sp.length }),
        crab: () => prefab("crab", { length: sp.length }),
        elbow_crab: () => prefab("elbow_crab", { length: sp.length }),
      };
      this.prefabs.set(sp.id, (map[sp.id]?.() ?? Promise.resolve(null)).catch((e) => { console.warn("model", sp.id, e); return null; }));
    }
    return this.prefabs.get(sp.id)!;
  }

  private eligible(depth: number, zone: Zone[]): Species3D[] {
    const tags = [this.world.missionId ?? "", ...this.world.regionTags];
    return SPECIES_3D.filter((s) =>
      depth >= s.depth[0] - 5 && depth <= s.depth[1] + 5 &&
      s.zones.some((z) => zone.includes(z)) &&
      (s.where.length === 0 || s.where.some((w) => tags.includes(w))) &&
      !(this.world.missionId === "baikal"),
    );
  }

  private zonesAt(depth: number, floorDepth: number): Zone[] {
    const z: Zone[] = ["open"];
    if (depth < 10) z.push("surface");
    if (floorDepth < 60) z.push("shallow");
    if (this.world.missionId === "reef_guam") z.push("reef", "cave", "wreck");
    if (depth > 200) z.push("deep");
    if (depth > 6000) z.push("trench");
    if (floorDepth - depth < 25) z.push("floor");
    return z;
  }

  /** Scan: identify the nearest visible creature in front of the craft. */
  scan(craft: CraftInfo, maxDist = 25): Species3D | null {
    let best: Agent | null = null, bd = maxDist;
    for (const a of this.agents) {
      const d = a.pos.distanceTo(craft.pos);
      const to = a.pos.clone().sub(craft.pos).normalize();
      if (d < bd && to.dot(craft.forward) > 0.3) { bd = d; best = a; }
    }
    if (!best) return null;
    best.scanned = true;
    return best.sp;
  }

  count() { return this.agents.length; }
  speciesPresent(): string[] { return [...new Set(this.agents.map((a) => a.sp.id))]; }

  private async spawnGroup(sp: Species3D, center: THREE.Vector3) {
    this.pending++;
    const pf = await this.getPrefab(sp);
    this.pending--;
    if (sp.kind === "asset" && !pf) return;
    const n = sp.group[0] + Math.floor(Math.random() * (sp.group[1] - sp.group[0] + 1));
    const gid = this.nextGroup++;
    for (let i = 0; i < n; i++) {
      let obj: THREE.Object3D, mixer: THREE.AnimationMixer | null = null, tick: Agent["tick"] = null;
      if (pf) {
        const inst = pf.make();
        obj = inst.obj;
        mixer = inst.mixer;
        const act = inst.actions.swimming ?? inst.actions["Swim Cycle"] ?? Object.values(inst.actions)[0];
        if (act) { act.play(); act.time = Math.random() * act.getClip().duration; }
        if (sp.id === "snapper" || sp.id === "barramundi") tick = addSwimBend(obj, 7);
        if (sp.id === "octopus") tick = tentacles(obj);
      } else {
        const p = this.procedural(sp);
        obj = p.obj;
        tick = p.tick;
      }
      const spread = Math.max(1, sp.length * 3) * Math.cbrt(n);
      const pos = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.4, (Math.random() - 0.5) * spread));
      if (sp.bottom) pos.y = -this.world.floor(pos.x, pos.z) + sp.length * 0.3;
      obj.position.copy(pos);
      this.group.add(obj);
      const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      this.agents.push({
        sp, obj, mixer, tick, pos, vel: dir.clone().multiplyScalar(sp.cruise), wander: dir, groupId: gid,
        prefDepth: -pos.y, alarmed: 0,
      });
    }
  }

  private procedural(sp: Species3D): ProcInstance {
    switch (sp.id) {
      case "aurelia": return jellyfish("aurelia", sp.length);
      case "atolla": return jellyfish("atolla", sp.length);
      case "manta": return manta(sp.length);
      case "moray": return moray(sp.length);
      case "lanternfish": return lanternfish(sp.length);
      case "angler": return anglerfish(sp.length);
      default: return snailfish(sp.length);
    }
  }

  update(dt: number, craft: CraftInfo) {
    dt = Math.min(dt, 0.1);
    const camDepth = -craft.pos.y;
    // despawn far agents
    this.agents = this.agents.filter((a) => {
      if (a.pos.distanceTo(craft.pos) < this.radius * 1.5) return true;
      this.group.remove(a.obj);
      return false;
    });
    // spawn
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.pending === 0) {
      this.spawnTimer = 0.8;
      const floorHere = this.world.floor(craft.pos.x, craft.pos.z);
      const zones = this.zonesAt(camDepth, floorHere);
      const cands = this.eligible(camDepth, zones);
      const byGroups = new Map<string, number>();
      for (const a of this.agents) byGroups.set(a.sp.id, (byGroups.get(a.sp.id) ?? 0) + 1);
      const weights = cands.map((s) => s.density / (1 + (byGroups.get(s.id) ?? 0) / Math.max(1, s.group[0])));
      const total = weights.reduce((a, b) => a + b, 0);
      if (cands.length && this.agents.length < 70 && total > 0) {
        let r = Math.random() * total, pick = cands[0];
        for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) { pick = cands[i]; break; } }
        const ang = Math.random() * Math.PI * 2;
        const dist = 25 + Math.random() * 45;
        const c = craft.pos.clone().add(new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist));
        const fl = this.world.floor(c.x, c.z);
        const d = Math.min(Math.max(pick.depth[0], camDepth + (Math.random() - 0.5) * 20), Math.min(pick.depth[1], fl - 1.5));
        c.y = -Math.max(d, pick.surfaceOK ? 0.6 : 2);
        if (-c.y < fl) this.spawnGroup(pick, c);
      }
    }
    // behaviour
    const tmp = new THREE.Vector3(), steer = new THREE.Vector3();
    for (const a of this.agents) {
      const sp = a.sp;
      steer.set(0, 0, 0);
      // wander
      a.wander.add(tmp.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).multiplyScalar(dt * 1.2)).normalize();
      steer.addScaledVector(a.wander, sp.cruise);
      // schooling within group
      if (sp.group[1] > 1) {
        const coh = new THREE.Vector3(), ali = new THREE.Vector3(), sep = new THREE.Vector3();
        let k = 0;
        for (const b of this.agents) {
          if (b === a || b.groupId !== a.groupId) continue;
          const d = a.pos.distanceTo(b.pos);
          if (d > 8) continue;
          coh.add(b.pos); ali.add(b.vel); k++;
          if (d < sp.length * 2.2) sep.add(tmp.copy(a.pos).sub(b.pos).divideScalar(Math.max(d * d, 1e-3)));
        }
        if (k) {
          coh.divideScalar(k).sub(a.pos).multiplyScalar(0.5);
          ali.divideScalar(k).multiplyScalar(0.9);
          steer.add(coh).add(ali).addScaledVector(sep, sp.length * 1.5);
        }
      }
      // depth keeping / floor / surface
      const depth = -a.pos.y;
      const fl = this.world.floor(a.pos.x, a.pos.z);
      if (sp.bottom) {
        steer.y = (-(fl - sp.length * 0.3) - a.pos.y) * 2;
      } else {
        if (depth < sp.depth[0]) steer.y -= 0.4;
        if (depth > sp.depth[1]) steer.y += 0.4;
        steer.y += (a.prefDepth - depth) * -0.02;
        if (fl - depth < 2) steer.y += 1;
        if (depth < (sp.surfaceOK ? 0.4 : 1.5)) steer.y -= 1;
      }
      for (const o of this.world.obstacles) {
        const d = a.pos.distanceTo(o.pos);
        if (d < o.r + 2) steer.addScaledVector(tmp.copy(a.pos).sub(o.pos).normalize(), (o.r + 2 - d) * 1.5);
      }
      // reaction to the craft
      const toCraft = tmp.copy(craft.pos).sub(a.pos);
      const dc = toCraft.length();
      const inBeam = craft.lightsOn && dc < 25 && toCraft.clone().multiplyScalar(-1 / dc).dot(craft.forward) > 0.85;
      const threat = sp.flee * (1 + craft.noise * 1.5 + craft.vel.length() * 0.8) * (inBeam && sp.light === "avoid" ? 2 : 1);
      if (dc < threat) {
        steer.addScaledVector(toCraft.normalize(), -sp.cruise * 4);
        if (a.alarmed <= 0 && dc < threat * 0.5) this.onAlarm?.(sp);
        a.alarmed = 2;
      } else if (sp.light === "attract" && inBeam) {
        const target = craft.pos.clone().addScaledVector(craft.forward, 6);
        steer.addScaledVector(target.sub(a.pos).normalize(), sp.cruise * 1.5);
      } else if (sp.curious && dc < 30) {
        // orbit around the craft at ~12 m
        const radial = toCraft.normalize();
        const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
        steer.addScaledVector(tangent, sp.cruise).addScaledVector(radial, (dc - 12) * 0.1);
      }
      a.alarmed -= dt;
      // integrate
      const maxV = sp.cruise * (a.alarmed > 0 ? 3.5 : 1.3);
      a.vel.lerp(steer, Math.min(1, dt * (a.alarmed > 0 ? 3 : 1.2)));
      if (a.vel.length() > maxV) a.vel.setLength(maxV);
      a.pos.addScaledVector(a.vel, dt);
      if (sp.bottom && -a.pos.y > fl) a.pos.y = -fl;
      a.obj.position.copy(a.pos);
      // orientation: jellies stay upright; others face their velocity (head = +X)
      const sp2 = a.vel.lengthSq();
      if (sp.id !== "aurelia" && sp.id !== "atolla" && sp2 > 1e-6) {
        const dir = a.vel.clone().normalize();
        if (sp.bottom) dir.y = 0;
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
        a.obj.quaternion.slerp(q, Math.min(1, dt * 3));
      }
      const sf = Math.min(3, Math.max(0.4, Math.sqrt(sp2) / Math.max(sp.cruise, 1e-3)));
      a.mixer?.update(dt * sf);
      a.tick?.(dt, sf);
      // Atolla flashes when the craft comes close
      if (sp.id === "atolla") a.obj.traverse((o) => { if (o.name === "biolum") ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = a.alarmed > 0 ? 6 * (0.5 + 0.5 * Math.sin(performance.now() / 60)) : 0.3; });
    }
  }

  dispose() {
    for (const a of this.agents) this.group.remove(a.obj);
    this.agents = [];
  }
}

/** Curl the octopus arm bones (Bone00…Bone48) with phase-shifted waves. */
function tentacles(obj: THREE.Object3D) {
  const bones: THREE.Bone[] = [];
  obj.traverse((o) => { if ((o as THREE.Bone).isBone && /^Bone\d+/.test(o.name)) bones.push(o as THREE.Bone); });
  const rest = bones.map((b) => b.rotation.clone());
  let t = Math.random() * 10;
  return (dt: number, s: number) => {
    t += dt * s;
    bones.forEach((b, i) => {
      const arm = Math.floor(i / 6), seg = i % 6;
      b.rotation.x = rest[i].x + Math.sin(t * 1.3 + arm * 0.8 - seg * 0.6) * 0.12 * (seg + 1) * 0.35;
      b.rotation.z = rest[i].z + Math.cos(t * 0.9 + arm * 1.1 - seg * 0.5) * 0.1 * (seg + 1) * 0.3;
    });
  };
}
