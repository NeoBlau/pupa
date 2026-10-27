import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, type MeshBVH } from 'three-mesh-bvh';
import type { ModelDef, ToolId } from '@shared/game.ts';
import { createTextures, type TexName, type Textures } from './textures.ts';
import { loadScan, proceduralFoot, type FootAsset } from './foot.ts';
import { Paint, patchSkinMaterial, type LayerId, type StampOpts } from './paint.ts';
import { loadMaterials, type Materials } from './materials.ts';
import { createTool, type ToolName } from './tools3d.ts';
import { roundedSlab } from './geom.ts';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type { LayerId };
export type V3 = THREE.Vector3;

export interface Ptr {
  /** Tool tip on the skin (world). */
  p: THREE.Vector3;
  n: THREE.Vector3;
  uv: THREE.Vector2;
  /** Movement since the last event (world). */
  delta: THREE.Vector3;
  /** metres per second */
  speed: number;
  down: boolean;
  /** Is the tool currently over the foot? */
  hit: boolean;
}

export interface SubTool {
  id: string;
  label: string;
  icon: string;
}

export interface Step {
  title: string;
  hint: string;
  cursor?: ToolName | null;
  tools?: SubTool[];
  tool?: string;
  enter?(): void;
  exit?(): void;
  update?(dt: number): void;
  down?(p: Ptr): void;
  move?(p: Ptr): void;
  up?(p: Ptr): void;
  select?(id: string): void;
  progress(): number;
}

export interface Procedure {
  id: ToolId;
  steps: Step[];
  accuracy(): number;
  dispose?(): void;
}

export interface StepView {
  procedure: ToolId;
  steps: string[];
  index: number;
  title: string;
  hint: string;
  progress: number;
  tools?: SubTool[];
  tool?: string;
  finished: boolean;
}

export interface EngineHooks {
  onWork(units: number): void;
  onFinish(tool: ToolId, accuracy: number): void;
  onStep(view: StepView | null): void;
  onLoad?(progress: number): void;
  sfx(name: string): void;
  loop(name: string, on: boolean): void;
  haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'tick'): void;
}

interface Particle {
  s: THREE.Sprite;
  v: THREE.Vector3;
  g: number;
  life: number;
  max: number;
  grow: number;
  spin: number;
  fade: boolean;
  onEnd?: () => void;
}

interface Attached {
  o: THREE.Object3D;
  p: THREE.Vector3;
  vi: number;
}

interface Tween {
  t: number;
  dur: number;
  fn: (k: number) => void;
  done?: () => void;
}

interface FloatText {
  el: HTMLDivElement;
  p: THREE.Vector3;
  life: number;
}

export const ease = {
  out: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------

export class Engine {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10);
  controls!: OrbitControls;
  root = new THREE.Group();
  footGroup = new THREE.Group();
  T!: Textures;
  M!: Materials;
  hooks: EngineHooks;

  foot!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private rayMesh!: THREE.Mesh;
  private bvh!: MeshBVH;
  paint!: Paint;
  asset!: FootAsset;

  /** 1 "u" = 1/1160 of the foot length (same scale the procedures were tuned with). */
  u = 0.25 / 1160;
  L!: FootAsset['landmarks'];

  // soft body
  private base = new Float32Array(0);
  private baseN = new Float32Array(0);
  private off = new Float32Array(0);
  private vel = new Float32Array(0);
  private target = new Float32Array(0);
  private moving = false;
  private forces: { p: THREE.Vector3; r: number; d: THREE.Vector3; push: number }[] = [];
  private hash = new Map<number, number[]>();

  private particles: Particle[] = [];
  private attached: Attached[] = [];
  private tweens: Tween[] = [];
  private texts: FloatText[] = [];
  private spriteTex = new Map<string, THREE.Texture>();
  private shakeAmt = 0;
  time = 0;

  procedure: Procedure | null = null;
  stepIndex = 0;
  private stepDoneAt = 0;
  private finished = false;
  private lastView = '';

  ptr: Ptr = { p: new THREE.Vector3(), n: new THREE.Vector3(0, 0, 1), uv: new THREE.Vector2(), delta: new THREE.Vector3(), speed: 0, down: false, hit: false };
  private tipOffset = 0;
  private lastMoveT = 0;
  private pointers = new Set<number>();
  private pointerType = 'mouse';
  private raycaster = new THREE.Raycaster();

  tool: THREE.Object3D | null = null;
  private toolName: ToolName | null = null;
  private toolCache = new Map<ToolName, THREE.Object3D>();
  /** Extra per-frame tool pose tweaks set by steps (vibration, tilt, squeeze). */
  toolPose = { jitter: 0, tilt: 0, lift: 0, spin: 0 };

  private unitAcc = 0;
  private unitTokens = 18;
  private overlay!: HTMLElement;
  private host!: HTMLElement;
  private resizeObs?: ResizeObserver;
  private raf = 0;
  private running = true;
  private clock = new THREE.Clock();
  ready = false;
  model: ModelDef | null = null;
  debug: Record<string, unknown> = {};

  constructor(hooks: EngineHooks) {
    this.hooks = hooks;
  }

  // -------------------------------------------------------------------------
  // Setup

  async init(host: HTMLElement, overlay: HTMLElement) {
    this.host = host;
    this.overlay = overlay;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(r.domElement);
    r.domElement.style.touchAction = 'none';
    this.renderer = r;
    this.T = createTextures();

    // Studio lighting: HDRI for reflections + key/rim lights for shape.
    const pmrem = new THREE.PMREMGenerator(r);
    const hdr = await new RGBELoader().loadAsync('env/studio.hdr');
    this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
    this.scene.environmentIntensity = 0.55;
    hdr.dispose();
    pmrem.dispose();
    this.hooks.onLoad?.(0.3);

    this.M = await loadMaterials(r, (k) => this.hooks.onLoad?.(0.3 + k * 0.5));

    this.scene.background = new THREE.Color(0x0c0812);
    this.scene.fog = new THREE.Fog(0x0c0812, 0.6, 1.4);
    const key = new THREE.DirectionalLight(0xfff1e2, 2.4);
    key.position.set(0.25, 0.45, 0.55);
    key.target.position.set(0, 0.12, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -0.25;
    key.shadow.camera.right = key.shadow.camera.top = 0.25;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 1.5;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.002;
    key.shadow.radius = 6;
    const rim = new THREE.DirectionalLight(0xff7ab8, 1.6);
    rim.position.set(-0.45, 0.35, -0.3);
    const fill = new THREE.HemisphereLight(0xcab8ff, 0x1a0e14, 0.35);
    this.scene.add(key, key.target, rim, fill, this.root);

    // Velvet couch the leg rests on + a towel under the heel + tool tray.
    const couch = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.M.velvet);
    couch.position.set(0, 0.1, -0.17);
    couch.receiveShadow = true;
    const towel = new THREE.Mesh(roundedSlab(0.34, 0.2, 0.012, 0.006), this.M.terry);
    towel.position.set(0.01, -0.035, -0.12);
    towel.rotation.x = -Math.PI / 2 + 0.25;
    towel.receiveShadow = true;
    towel.castShadow = true;
    const tray = new THREE.Mesh(roundedSlab(0.16, 0.38, 0.01, 0.006), this.M.marble);
    tray.position.set(0.19, 0.12, -0.16);
    tray.rotation.x = 0;
    tray.receiveShadow = true;
    this.root.add(couch, towel, tray, this.footGroup);

    this.camera.position.set(0, 0.12, 0.48);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0.12, -0.02);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.22;
    this.controls.maxDistance = 0.75;
    this.controls.minAzimuthAngle = -1.1;
    this.controls.maxAzimuthAngle = 1.1;
    this.controls.minPolarAngle = 0.5;
    this.controls.maxPolarAngle = 2.2;
    // One finger / left mouse = the tool. Two fingers / right mouse = camera.
    this.controls.mouseButtons = { LEFT: -1 as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: -1 as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };

    const el = r.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => {
      if (!this.ptr.down) this.ptr.hit = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.ready = true;
    this.loop();
  }

  resetCamera() {
    const from = this.camera.position.clone();
    const to = new THREE.Vector3(0, 0.12, 0.48);
    this.tween(0.5, (k) => this.camera.position.lerpVectors(from, to, ease.inOut(k)));
  }

  setRunning(on: boolean) {
    this.running = on;
    if (on && !this.raf) {
      this.clock.getDelta();
      this.loop();
    }
  }

  private loop = () => {
    this.raf = 0;
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    this.update(Math.min(this.clock.getDelta(), 0.05));
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.resizeObs?.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the whole foot in frame on narrow phones.
    this.camera.fov = w / h < 0.7 ? 38 : 30;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Foot

  async loadModel(def: ModelDef) {
    this.model = def;
    this.setProcedure(null);
    for (const a of this.attached) a.o.removeFromParent();
    this.attached = [];
    for (const p of this.particles) p.s.removeFromParent();
    this.particles = [];
    this.tweens = [];
    this.footGroup.clear();
    this.paint?.dispose();
    this.foot?.geometry.dispose();

    let asset: FootAsset;
    if (def.scan) {
      try {
        asset = await loadScan(def.scan, def.scanRotation);
      } catch (e) {
        console.warn('Scan failed, using procedural foot', e);
        asset = proceduralFoot(def, this.renderer);
      }
    } else asset = proceduralFoot(def, this.renderer);
    this.asset = asset;
    this.u = asset.length / 1160;
    this.L = asset.landmarks;

    const g = asset.geometry;
    this.paint = new Paint(this.renderer, this.T, g, asset.uvPerMeter);
    const mat = new THREE.MeshPhysicalMaterial({
      map: asset.map,
      normalMap: asset.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: asset.roughnessMap,
      roughness: 1,
      sheen: 0.6,
      sheenColor: new THREE.Color(0xffc6b4),
      sheenRoughness: 0.45,
      clearcoat: 0.001,
      specularIntensity: 0.55,
      specularColor: new THREE.Color(0xfff0e8),
    });
    patchSkinMaterial(mat, this.paint);
    this.foot = new THREE.Mesh(g, mat);
    this.foot.castShadow = true;
    this.foot.receiveShadow = true;

    // Static copy for picking (BVH), so deformation never breaks hit tests.
    const rg = g.clone();
    this.bvh = rg.computeBoundsTree();
    this.rayMesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ visible: false }));
    this.footGroup.add(this.foot, this.rayMesh, ...asset.extras);
    for (const x of asset.extras) {
      x.castShadow = true;
      x.receiveShadow = true;
    }

    const pos = g.attributes.position.array as Float32Array;
    this.base = Float32Array.from(pos);
    this.baseN = Float32Array.from(g.attributes.normal.array as Float32Array);
    this.off = new Float32Array(pos.length);
    this.vel = new Float32Array(pos.length);
    this.target = new Float32Array(pos.length);
    this.hash.clear();
    for (let i = 0; i < pos.length / 3; i++) {
      const k = this.hashKey(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      let list = this.hash.get(k);
      if (!list) this.hash.set(k, (list = []));
      list.push(i);
    }
    this.extraRest = asset.extras.map((x) => ({ o: x, p: x.position.clone(), vi: this.nearestVertex(x.position) }));
  }

  private extraRest: { o: THREE.Object3D; p: THREE.Vector3; vi: number }[] = [];

  private hashKey(x: number, y: number, z: number) {
    const c = 0.008;
    return ((Math.floor(x / c) + 512) * 1024 + (Math.floor(y / c) + 512)) * 1024 + (Math.floor(z / c) + 512);
  }

  nearestVertex(p: THREE.Vector3) {
    const c = 0.008;
    let best = -1;
    let bd = Infinity;
    for (let r = 1; r <= 3 && best < 0; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            const list = this.hash.get(this.hashKey(p.x + dx * c, p.y + dy * c, p.z + dz * c));
            if (!list) continue;
            for (const i of list) {
              const d = (this.base[i * 3] - p.x) ** 2 + (this.base[i * 3 + 1] - p.y) ** 2 + (this.base[i * 3 + 2] - p.z) ** 2;
              if (d < bd) {
                bd = d;
                best = i;
              }
            }
          }
    return Math.max(0, best);
  }

  /** Closest point on the skin with its normal and UV. */
  surfaceAt(p: THREE.Vector3) {
    const hit = this.bvh.closestPointToPoint(p);
    if (!hit) return null;
    return this.faceInfo(hit.faceIndex, hit.point);
  }

  private faceInfo(face: number, point: THREE.Vector3) {
    const g = this.rayMesh.geometry;
    const idx = g.index!;
    const [a, b, c] = [idx.getX(face * 3), idx.getX(face * 3 + 1), idx.getX(face * 3 + 2)];
    const pa = new THREE.Vector3().fromBufferAttribute(g.attributes.position, a);
    const pb = new THREE.Vector3().fromBufferAttribute(g.attributes.position, b);
    const pc = new THREE.Vector3().fromBufferAttribute(g.attributes.position, c);
    const bary = new THREE.Vector3();
    THREE.Triangle.getBarycoord(point, pa, pb, pc, bary);
    const uvA = g.attributes.uv;
    const uv = new THREE.Vector2(
      uvA.getX(a) * bary.x + uvA.getX(b) * bary.y + uvA.getX(c) * bary.z,
      uvA.getY(a) * bary.x + uvA.getY(b) * bary.y + uvA.getY(c) * bary.z,
    );
    const nA = g.attributes.normal;
    const n = new THREE.Vector3(
      nA.getX(a) * bary.x + nA.getX(b) * bary.y + nA.getX(c) * bary.z,
      nA.getY(a) * bary.x + nA.getY(b) * bary.y + nA.getY(c) * bary.z,
      nA.getZ(a) * bary.x + nA.getZ(b) * bary.y + nA.getZ(c) * bary.z,
    ).normalize();
    return { p: point.clone(), n, uv };
  }

  // -------------------------------------------------------------------------
  // Procedures

  setProcedure(p: Procedure | null) {
    this.procedure?.steps[this.stepIndex]?.exit?.();
    this.hooks.loop('*', false);
    this.procedure?.dispose?.();
    this.procedure = p;
    this.stepIndex = 0;
    this.stepDoneAt = 0;
    this.finished = false;
    this.lastView = '';
    this.toolPose = { jitter: 0, tilt: 0, lift: 0, spin: 0 };
    if (p) p.steps[0].enter?.();
    this.applyCursor();
    this.emitView(true);
  }

  get step(): Step | null {
    return this.procedure?.steps[this.stepIndex] ?? null;
  }

  selectTool(id: string) {
    const s = this.step;
    if (s?.select) s.select(id);
    else if (s) s.tool = id;
    this.applyCursor();
    this.emitView(true);
  }

  applyCursor() {
    const name = this.finished ? null : (this.step?.cursor ?? null);
    if (name === this.toolName) return;
    this.tool?.removeFromParent();
    this.toolName = name;
    this.tool = null;
    if (!name) return;
    let t = this.toolCache.get(name);
    if (!t) {
      t = createTool(name, this.M, this.T);
      t.traverse((o) => {
        o.castShadow = true;
      });
      this.toolCache.set(name, t);
    }
    this.tool = t;
    t.visible = false;
    this.root.add(t);
  }

  private emitView(force = false) {
    const p = this.procedure;
    const s = this.step;
    if (!p || !s) {
      if (force || this.lastView !== '') this.hooks.onStep(null);
      this.lastView = '';
      return;
    }
    const view: StepView = {
      procedure: p.id,
      steps: p.steps.map((x) => x.title),
      index: this.stepIndex,
      title: s.title,
      hint: s.hint,
      progress: Math.round(Math.min(1, s.progress()) * 100) / 100,
      tools: s.tools,
      tool: s.tool,
      finished: this.finished,
    };
    const key = JSON.stringify(view);
    if (force || key !== this.lastView) {
      this.lastView = key;
      this.hooks.onStep(view);
    }
  }

  private advance() {
    const p = this.procedure;
    if (!p || this.finished) return;
    const s = this.step!;
    if (s.progress() < 1) {
      this.stepDoneAt = 0;
      return;
    }
    if (!this.stepDoneAt) {
      this.stepDoneAt = this.time;
      this.hooks.sfx('step');
      this.hooks.haptic('success');
      return;
    }
    if (this.time - this.stepDoneAt < 0.6) return;
    this.stepDoneAt = 0;
    s.exit?.();
    this.hooks.loop('*', false);
    this.toolPose = { jitter: 0, tilt: 0, lift: 0, spin: 0 };
    if (this.stepIndex < p.steps.length - 1) {
      this.stepIndex++;
      this.step!.enter?.();
    } else {
      this.finished = true;
      this.hooks.onFinish(p.id, p.accuracy());
      this.celebrate();
    }
    this.applyCursor();
    this.emitView(true);
  }

  // -------------------------------------------------------------------------
  // Input

  private pick(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.rayMesh, false)[0];
    if (!hit || hit.faceIndex == null) return null;
    return this.faceInfo(hit.faceIndex, hit.point);
  }

  private updatePtr(e: PointerEvent) {
    const h = this.pick(e.clientX, e.clientY - this.tipOffset);
    if (!h) {
      this.ptr.hit = false;
      return false;
    }
    const now = performance.now();
    const dt = Math.max((now - this.lastMoveT) / 1000, 1 / 240);
    this.lastMoveT = now;
    if (this.ptr.hit) this.ptr.delta.subVectors(h.p, this.ptr.p);
    else this.ptr.delta.set(0, 0, 0);
    const speed = this.ptr.delta.length() / dt;
    this.ptr.speed = this.ptr.speed * 0.6 + speed * 0.4;
    this.ptr.p.copy(h.p);
    this.ptr.n.copy(h.n);
    this.ptr.uv.copy(h.uv);
    this.ptr.hit = true;
    return true;
  }

  private onDown(e: PointerEvent) {
    this.pointers.add(e.pointerId);
    this.pointerType = e.pointerType;
    if (this.pointers.size > 1 || e.button !== 0) {
      // Second finger: camera gesture — cancel the stroke.
      if (this.ptr.down) {
        this.ptr.down = false;
        this.step?.up?.(this.ptr);
      }
      return;
    }
    this.tipOffset = e.pointerType === 'touch' ? 56 : 0;
    this.ptr.hit = false;
    if (!this.updatePtr(e)) return;
    this.ptr.down = true;
    if (!this.finished) this.step?.down?.(this.ptr);
  }

  private onMove(e: PointerEvent) {
    if (this.pointers.size > 1) return;
    this.pointerType = e.pointerType;
    if (e.pointerType !== 'touch') this.tipOffset = 0;
    const wasHit = this.ptr.hit;
    if (!this.updatePtr(e)) return;
    if (!wasHit) this.ptr.delta.set(0, 0, 0);
    if (this.ptr.down && !this.finished) this.step?.move?.(this.ptr);
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (!this.ptr.down) return;
    this.ptr.down = false;
    if (!this.finished) this.step?.up?.(this.ptr);
    if (e.pointerType === 'touch') this.ptr.hit = false;
  }

  // -------------------------------------------------------------------------
  // Painting

  stamp(layer: LayerId, p: THREE.Vector3 | THREE.Vector2, r: number, o: StampOpts = {}) {
    const uv = p instanceof THREE.Vector2 ? p : this.surfaceAt(p)?.uv;
    if (uv) this.paint.stamp(layer, uv, r, o);
  }

  /** Stamps along a world-space segment, snapped to the skin. */
  paintLine(layer: LayerId, a: THREE.Vector3, b: THREE.Vector3, r: number, o: StampOpts = {}, spacing = 0.35) {
    const d = a.distanceTo(b);
    const n = Math.min(40, Math.max(1, Math.ceil(d / Math.max(1e-5, r * spacing))));
    for (let k = 1; k <= n; k++) this.stamp(layer, tmpV2.lerpVectors(a, b, k / n), r, o);
  }

  coverage(layer: LayerId, cells?: number[], thr = 0.5) {
    return this.paint.coverage(layer, cells, thr);
  }

  cellsInSphere(p: THREE.Vector3, r: number) {
    return this.paint.cellsInSphere(p, r);
  }

  fadeLayer(layer: LayerId, amount: number) {
    this.paint.fade(layer, amount);
  }

  clearLayer(layer: LayerId) {
    this.paint.clear(layer);
  }

  amountAt(layer: LayerId, uv: THREE.Vector2) {
    return this.paint.amountAt(layer, uv);
  }

  /** Random point on the sole, away from the edges and from `avoid`. */
  randomSolePoint(avoid: THREE.Vector3[] = [], minDist = 0, yMin = -Infinity, yMax = Infinity) {
    const P = this.paint;
    for (let tries = 0; tries < 300; tries++) {
      const c = P.validCells[Math.floor(Math.random() * P.validCells.length)];
      const p = P.cellWorld(c);
      if (p.y < yMin || p.y > yMax) continue;
      const x = c % 64;
      const y = Math.floor(c / 64);
      let inner = true;
      for (let dy = -2; dy <= 2 && inner; dy++) for (let dx = -2; dx <= 2; dx++) if (!P.valid[(y + dy) * 64 + x + dx]) inner = false;
      if (!inner) continue;
      if (avoid.every((a) => a.distanceTo(p) >= minDist)) {
        const s = this.surfaceAt(p);
        if (s) return s;
      }
    }
    return this.surfaceAt(this.L.center)!;
  }

  // -------------------------------------------------------------------------
  // Soft-body skin

  /** Drag skin near p by d this frame. */
  force(p: THREE.Vector3, r: number, d: THREE.Vector3) {
    this.forces.push({ p: p.clone(), r, d: d.clone(), push: 0 });
  }

  /** Press the skin in along its normal (negative depth = bulge out). */
  press(p: THREE.Vector3, r: number, depth: number) {
    this.forces.push({ p: p.clone(), r, d: new THREE.Vector3(), push: depth });
  }

  /** Instant push along the skin normal (a drop landing, a needle going in). */
  impulse(p: THREE.Vector3, r: number, amount: number) {
    const { base, baseN, vel } = this;
    const r2 = r * r;
    for (let i = 0; i < base.length; i += 3) {
      const d2 = (base[i] - p.x) ** 2 + (base[i + 1] - p.y) ** 2 + (base[i + 2] - p.z) ** 2;
      if (d2 > r2 * 4) continue;
      const f = Math.exp(-d2 / r2) * amount;
      vel[i] -= baseN[i] * f;
      vel[i + 1] -= baseN[i + 1] * f;
      vel[i + 2] -= baseN[i + 2] * f;
      this.moving = true;
    }
  }

  kick(p: THREE.Vector3, r: number, amount: number) {
    const { base, vel } = this;
    const r2 = r * r;
    for (let i = 0; i < base.length; i += 3) {
      const d2 = (base[i] - p.x) ** 2 + (base[i + 1] - p.y) ** 2 + (base[i + 2] - p.z) ** 2;
      if (d2 > r2 * 4) continue;
      const f = Math.exp(-d2 / r2);
      vel[i] += (Math.random() - 0.5) * amount * f;
      vel[i + 1] += (Math.random() - 0.5) * amount * f;
      vel[i + 2] += (Math.random() - 0.5) * amount * f;
      this.moving = true;
    }
  }

  /** Current displacement of the skin near p. */
  skinOffset(vi: number, out = new THREE.Vector3()) {
    return out.set(this.off[vi * 3], this.off[vi * 3 + 1], this.off[vi * 3 + 2]);
  }

  private updateSkin(dt: number) {
    const { base, baseN, off, vel, target, forces } = this;
    if (!forces.length && !this.moving) return;
    target.fill(0);
    for (const f of forces) {
      const r2 = f.r * f.r;
      for (let i = 0; i < base.length; i += 3) {
        const ex = base[i] - f.p.x;
        const ey = base[i + 1] - f.p.y;
        const ez = base[i + 2] - f.p.z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > r2 * 4) continue;
        const w = Math.exp(-d2 / r2);
        target[i] += (f.d.x - baseN[i] * f.push) * w;
        target[i + 1] += (f.d.y - baseN[i + 1] * f.push) * w;
        target[i + 2] += (f.d.z - baseN[i + 2] * f.push) * w;
      }
    }
    forces.length = 0;
    const k = 260;
    const damp = Math.exp(-15 * dt);
    let moving = false;
    for (let i = 0; i < base.length; i++) {
      vel[i] = (vel[i] + (target[i] - off[i]) * k * dt) * damp;
      off[i] += vel[i] * dt;
      if (!moving && (Math.abs(off[i]) > 1e-6 || Math.abs(vel[i]) > 1e-5)) moving = true;
    }
    this.moving = moving;
    const pos = this.foot.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < base.length; i++) arr[i] = base[i] + off[i];
    pos.needsUpdate = true;
    this.foot.geometry.computeVertexNormals();
    for (const x of this.extraRest) x.o.position.copy(x.p).add(this.skinOffset(x.vi, tmpV));
  }

  // -------------------------------------------------------------------------
  // Objects, particles, decals, tweens

  /** Keeps an object glued to the skin at p (follows deformation). */
  attach<T extends THREE.Object3D>(o: T, p: THREE.Vector3, n?: THREE.Vector3) {
    o.position.copy(p);
    if (n) o.quaternion.setFromUnitVectors(UP, n);
    this.attached.push({ o, p: p.clone(), vi: this.nearestVertex(p) });
    this.root.add(o);
    return o;
  }

  moveAttached(o: THREE.Object3D, p: THREE.Vector3) {
    const a = this.attached.find((q) => q.o === o);
    if (a) {
      a.p.copy(p);
      a.vi = this.nearestVertex(p);
    }
  }

  detach(o: THREE.Object3D) {
    this.attached = this.attached.filter((a) => a.o !== o);
    o.removeFromParent();
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.isMesh && m.geometry && !(m.geometry as unknown as { shared?: boolean }).shared) m.geometry.dispose();
    });
  }

  /** A sticker that wraps over the skin (bandage, wound, film). */
  decal(material: THREE.Material, p: THREE.Vector3, n: THREE.Vector3, size: THREE.Vector3, rot = 0) {
    const helper = new THREE.Object3D();
    helper.position.copy(p);
    helper.lookAt(tmpV.copy(p).add(n));
    helper.rotateZ(rot);
    this.rayMesh.updateMatrixWorld();
    const geo = new DecalGeometry(this.rayMesh, p, helper.rotation, size);
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    m.renderOrder = 2;
    const holder = new THREE.Group();
    holder.add(m);
    m.position.sub(p);
    this.attach(holder, p);
    return holder;
  }

  sprite(tex: TexName) {
    let t = this.spriteTex.get(tex);
    if (!t) {
      t = new THREE.CanvasTexture(this.T[tex]);
      t.colorSpace = THREE.SRGBColorSpace;
      this.spriteTex.set(tex, t);
    }
    return t;
  }

  particle(
    tex: TexName,
    p: THREE.Vector3,
    size: number,
    o: { v?: THREE.Vector3; g?: number; max?: number; grow?: number; spin?: number; fade?: boolean; tint?: number; alpha?: number; add?: boolean; onEnd?: () => void } = {},
  ) {
    const mat = new THREE.SpriteMaterial({
      map: this.sprite(tex),
      color: o.tint ?? 0xffffff,
      opacity: o.alpha ?? 1,
      transparent: true,
      depthWrite: false,
      blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending,
      rotation: Math.random() * Math.PI * 2,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(p);
    s.scale.setScalar(size);
    s.renderOrder = 5;
    this.root.add(s);
    this.particles.push({ s, v: o.v?.clone() ?? new THREE.Vector3(), g: o.g ?? 0, life: 0, max: o.max ?? 1, grow: o.grow ?? 0, spin: o.spin ?? 0, fade: o.fade ?? true, onEnd: o.onEnd });
    return s;
  }

  floatText(p: THREE.Vector3, text: string, color = '#fff', size = 22) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    this.overlay.appendChild(el);
    this.texts.push({ el, p: p.clone(), life: 0 });
  }

  ripple(p: THREE.Vector3, color = 0xffffff, size = 0.012) {
    this.particle('ring', p.clone().addScaledVector(this.ptr.n, 0.001), size, { tint: color, grow: 2.4, max: 0.5 });
  }

  tween(dur: number, fn: (k: number) => void, done?: () => void) {
    this.tweens.push({ t: 0, dur, fn, done });
  }

  shake(amount: number) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  work(units: number) {
    this.unitAcc = Math.min(this.unitAcc + units, 40);
  }

  private celebrate() {
    const c = this.L.center.clone().add(new THREE.Vector3(0, 0, 0.03));
    for (let i = 0; i < 30; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.25, Math.random() * 0.2, (Math.random() - 0.2) * 0.15);
      this.particle(i % 3 ? 'sparkle' : 'heart', c, 0.006 + Math.random() * 0.008, { v, g: -0.35, max: 1.4, spin: 3, add: i % 3 !== 0, tint: i % 3 ? 0xfff3b0 : 0xffffff });
    }
    this.hooks.sfx('success');
    this.hooks.haptic('success');
  }

  // -------------------------------------------------------------------------

  private poseTool() {
    const t = this.tool;
    if (!t) return;
    const touch = this.pointerType === 'touch';
    t.visible = this.ptr.hit && (this.ptr.down || !touch) && !this.finished;
    if (!t.visible) return;
    // Tool axis: mostly along the skin normal, leaning toward the camera.
    const toCam = tmpV.copy(this.camera.position).sub(this.ptr.p).normalize();
    const axis = tmpV2.copy(this.ptr.n).multiplyScalar(0.55).add(toCam.multiplyScalar(0.45 + this.toolPose.tilt)).normalize();
    t.quaternion.setFromUnitVectors(UP, axis);
    if (this.toolPose.spin) t.rotateY(this.toolPose.spin);
    const hover = (this.ptr.down ? 0 : 0.006) + this.toolPose.lift;
    t.position.copy(this.ptr.p).addScaledVector(axis, hover);
    if (this.toolPose.jitter) t.position.add(new THREE.Vector3((Math.random() - 0.5) * this.toolPose.jitter, (Math.random() - 0.5) * this.toolPose.jitter, (Math.random() - 0.5) * this.toolPose.jitter));
  }

  private update(dt: number) {
    if (!this.foot) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.time += dt;
    this.ptr.speed *= Math.exp(-6 * dt);

    const step = this.finished ? null : this.step;
    step?.update?.(dt);
    this.updateSkin(dt);
    this.paint.flush();

    for (const a of this.attached) a.o.position.copy(a.p).add(this.skinOffset(a.vi, tmpV));

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.v.y += p.g * dt;
      p.s.position.addScaledVector(p.v, dt);
      const m = p.s.material;
      m.rotation += p.spin * dt;
      if (p.grow) p.s.scale.multiplyScalar(1 + p.grow * dt);
      if (p.fade) m.opacity = Math.max(0, 1 - (p.life / p.max) ** 2);
      if (p.life >= p.max) {
        p.onEnd?.();
        p.s.removeFromParent();
        m.dispose();
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fn(k);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        t.done?.();
      }
    }

    // Camera: damping, shake, slow breathing
    this.controls.update();
    this.shakeAmt *= Math.exp(-8 * dt);
    this.root.position.set((Math.random() - 0.5) * this.shakeAmt * 0.0004, (Math.random() - 0.5) * this.shakeAmt * 0.0004, 0);
    this.footGroup.rotation.x = Math.sin(this.time * 1.2) * 0.004;

    this.poseTool();

    // Floating DOM texts
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += dt;
      const v = tmpV.copy(t.p).project(this.camera);
      t.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h - t.life * 60}px) translate(-50%, -50%) scale(${1 + t.life * 0.2})`;
      t.el.style.opacity = String(Math.max(0, 1 - (t.life / 1.2) ** 2));
      if (t.life > 1.2) {
        t.el.remove();
        this.texts.splice(i, 1);
      }
    }

    // units → coins, capped to what the server accepts
    this.unitTokens = Math.min(18, this.unitTokens + dt * 18);
    const k = Math.min(Math.floor(this.unitAcc), Math.floor(this.unitTokens));
    if (k > 0) {
      this.unitAcc -= k;
      this.unitTokens -= k;
      this.hooks.onWork(k);
    }

    this.advance();
    if (Math.floor(this.time * 10) !== Math.floor((this.time - dt) * 10)) this.emitView();
    this.renderer.render(this.scene, this.camera);
  }
}
