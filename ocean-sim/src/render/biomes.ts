/**
 * Static environment around the dive site: textured seafloor that follows the
 * craft (height = sim/terrain.ts relief, shared with collision physics), and
 * mission scenery — rocky reef, seagrass, a cave under a rock arch and an
 * illustrative wreck on the Guam reef; hydrothermal chimneys at TAG.
 */
import * as THREE from "three";
import { reliefHeight, type Relief } from "../sim/terrain";
import { loadModel } from "./life/assets";
import { patchObject, patchMaterial } from "./water";

const texLoader = new THREE.TextureLoader();
function tex(name: string, srgb = true) {
  const t = texLoader.load(`${import.meta.env.BASE_URL}textures/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Seafloor {
  readonly mesh: THREE.Mesh;
  private size = 260;
  private seg = 130;
  private last = new THREE.Vector2(1e9, 1e9);

  constructor(private relief: Relief, private meanDepth: number, tintHex = 0xffffff) {
    const g = new THREE.PlaneGeometry(this.size, this.size, this.seg, this.seg);
    g.rotateX(-Math.PI / 2);
    const col = tex("sand_color.webp");
    const nrm = tex("sand_normal.webp", false);
    const orm = tex("sand_orm.webp", false);
    for (const t of [col, nrm, orm]) t.repeat.set(this.size / 8, this.size / 8);
    const mat = new THREE.MeshStandardMaterial({ map: col, normalMap: nrm, aoMap: orm, roughnessMap: orm, roughness: 1, color: tintHex });
    patchMaterial(mat, true);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  /** floor depth [m] at three (x, z) — identical to the physics floor. */
  depthAt(x: number, z: number) {
    return this.meanDepth - reliefHeight(x, -z, this.relief);
  }

  update(cam: THREE.Vector3) {
    const step = this.size / this.seg;
    const cx = Math.round(cam.x / step) * step, cz = Math.round(cam.z / step) * step;
    this.mesh.visible = -cam.y > this.meanDepth - 400;
    if (!this.mesh.visible || (this.last.x === cx && this.last.y === cz)) return;
    this.last.set(cx, cz);
    const p = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const n = this.seg + 1;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const x = cx + (j / this.seg - 0.5) * this.size;
      const z = cz + (i / this.seg - 0.5) * this.size;
      p.setXYZ(k, x, -this.depthAt(x, z), z);
    }
    p.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    // keep texture fixed to the world
    const uv = this.mesh.geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = i * n + j;
      uv.setXY(k, (cx / this.size) + j / this.seg, -(cz / this.size) + 1 - i / this.seg);
    }
    uv.needsUpdate = true;
  }
}

export interface Scenery { group: THREE.Group; obstacles: Array<{ pos: THREE.Vector3; r: number }>; update?: (t: number) => void }

async function glbClone(id: string) {
  const g = await loadModel(id);
  const s = g.scene.clone(true);
  patchObject(s);
  return s;
}

function sizeOf(o: THREE.Object3D) {
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}

/** Branching coral grown with a stochastic L-system of tapered tubes (procedural). */
function branchCoral(height: number, color: number, seed: number): THREE.Mesh {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const geos: THREE.BufferGeometry[] = [];
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3((rnd() - 0.5) * len * 0.2, 0, (rnd() - 0.5) * len * 0.2));
    geos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 4, r, 5, false));
    if (depth <= 0) {
      const tip = new THREE.SphereGeometry(r * 1.15, 5, 4);
      tip.translate(to.x, to.y, to.z);
      geos.push(tip);
      return;
    }
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.1, 0.35 + rnd() * 0.3, (rnd() - 0.5) * 1.1)).normalize();
      grow(to, d, len * (0.65 + rnd() * 0.15), r * 0.72, depth - 1);
    }
  };
  grow(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), height * 0.35, height * 0.05, 3);
  const merged = mergeGeometries(geos);
  const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  patchObject(m);
  return m;
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    pos.push(...(ng.getAttribute("position").array as Float32Array));
    nor.push(...(ng.getAttribute("normal").array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/** Guam fore-reef at ~30 m: rocky reef, seagrass, corals, cave under an arch, wreck. */
export async function reefScenery(floor: Seafloor): Promise<Scenery> {
  const group = new THREE.Group();
  const obstacles: Scenery["obstacles"] = [];
  const place = (o: THREE.Object3D, x: number, z: number, lift = 0) => {
    o.position.set(x, -floor.depthAt(x, z) + lift, z);
    group.add(o);
  };
  const [rocks, barn, wreck, arch] = await Promise.all([glbClone("reef_rocks"), glbClone("barnacle_rocks"), glbClone("shipwreck"), glbClone("rock_arch")]);
  // rocky reef patches around the start point
  for (let i = 0; i < 6; i++) {
    const r = rocks.clone(true);
    r.rotation.y = i * 1.3;
    r.scale.setScalar(1.3 + (i % 3) * 0.3);
    const a = (i / 6) * Math.PI * 2, d = 14 + (i % 2) * 10;
    place(r, Math.cos(a) * d, Math.sin(a) * d - 10);
    obstacles.push({ pos: r.position.clone().setY(r.position.y + 1), r: 5 });
  }
  for (let i = 0; i < 5; i++) {
    const b = barn.clone(true);
    b.rotation.y = i * 2.1;
    b.scale.setScalar(1.2);
    place(b, -25 + i * 12, -30 + (i % 2) * 8);
    obstacles.push({ pos: b.position.clone().setY(b.position.y + 1), r: 5 });
  }
  // cave: two large rock formations leaning together, open along X
  const aSize = sizeOf(arch);
  const k = 9 / Math.max(aSize.y, 0.01);
  for (const s of [1, -1]) {
    const w = arch.clone(true);
    w.scale.set(k * 1.6, k, k * 1.6);
    w.rotation.set(0, s > 0 ? 0 : Math.PI, s * 0.35);
    place(w, 30, -35 + s * 4.5, -0.5);
    obstacles.push({ pos: w.position.clone().setY(w.position.y + 3).add(new THREE.Vector3(0, 0, s * 2)), r: 3.5 });
  }
  const roof = barn.clone(true);
  roof.scale.set(0.9, 0.5, 0.9);
  roof.rotation.x = Math.PI;
  place(roof, 30, -35, 8.5);
  // wreck resting on the sand, slightly heeled
  const ws = sizeOf(wreck);
  wreck.scale.setScalar(26 / Math.max(ws.x, ws.z));
  wreck.rotation.set(0.12, 0.6, 0.18);
  place(wreck, -40, 25, -0.8);
  obstacles.push({ pos: wreck.position.clone().setY(wreck.position.y + 3), r: 8 }, { pos: wreck.position.clone().add(new THREE.Vector3(8, 3, -5)), r: 5 }, { pos: wreck.position.clone().add(new THREE.Vector3(-8, 3, 5)), r: 5 });
  // corals (procedural, flagged in credits)
  const palette = [0xd98b6b, 0xc9a24a, 0x8f6fb8, 0xd6c7a1, 0x6fa38a];
  for (let i = 0; i < 28; i++) {
    const c = branchCoral(0.8 + (i % 5) * 0.3, palette[i % palette.length], 1000 + i * 77);
    const a = i * 2.39, d = 6 + (i * 7) % 30;
    place(c, Math.cos(a) * d + 5, Math.sin(a) * d - 8);
  }
  return { group, obstacles };
}

/** TAG: black-smoker chimneys with a buoyant particle plume. */
export function ventScenery(floor: Seafloor): Scenery {
  const group = new THREE.Group();
  const obstacles: Scenery["obstacles"] = [];
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 1 });
  patchMaterial(mat, true);
  const chimneys: Array<{ top: THREE.Vector3 }> = [];
  for (let i = 0; i < 7; i++) {
    const h = 5 + (i * 3.7) % 11;
    const prof: THREE.Vector2[] = [];
    for (let k = 0; k <= 12; k++) {
      const y = (k / 12) * h;
      prof.push(new THREE.Vector2(1.6 - (k / 12) * 1.1 + 0.25 * Math.sin(k * 1.7 + i), y));
    }
    const c = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), mat);
    const x = (i - 3) * 6 + ((i * 13) % 5), z = -18 - ((i * 7) % 12);
    c.position.set(x, -floor.depthAt(x, z) - 0.3, z);
    group.add(c);
    obstacles.push({ pos: c.position.clone().setY(c.position.y + h / 2), r: 2 });
    chimneys.push({ top: c.position.clone().setY(c.position.y + h) });
  }
  const N = 2400;
  const pp = new Float32Array(N * 3);
  const plume = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pp, 3)), new THREE.PointsMaterial({ color: 0x3d3834, size: 0.7, transparent: true, opacity: 0.55, depthWrite: false }));
  plume.frustumCulled = false;
  group.add(plume);
  return {
    group,
    obstacles,
    update: (t: number) => {
      for (let i = 0; i < N; i++) {
        const c = chimneys[i % chimneys.length].top;
        const age = (t * 0.9 + i * 0.37) % 35;
        const spread = 0.2 + age * 0.22; // entraining buoyant plume widens with height
        pp[i * 3] = c.x + Math.sin(i * 12.9898) * spread;
        pp[i * 3 + 1] = c.y + age * 1.1;
        pp[i * 3 + 2] = c.z + Math.cos(i * 78.233) * spread;
      }
      plume.geometry.getAttribute("position").needsUpdate = true;
    },
  };
}
