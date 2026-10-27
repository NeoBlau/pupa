import {
  Application,
  Assets,
  Container,
  Mesh,
  MeshPlane,
  RenderTexture,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type Texture,
} from 'pixi.js';
import type { ModelDef, ToolId } from '@shared/game.ts';
import { createTextures, type TexName, type Textures } from './textures.ts';

// ---------------------------------------------------------------------------
// Types shared with procedures

export type LayerId = 'redness' | 'ink' | 'shade' | 'stencil' | 'smudge' | 'fluid' | 'oil' | 'gloss' | 'wet' | 'foam' | 'frost';

/** Bottom to top. Stamps are white; tint/alpha/blend of the whole layer give the look. */
const LAYER_DEFS: { id: LayerId; tint: number; alpha: number; blend: 'normal' | 'add' }[] = [
  { id: 'redness', tint: 0xff2a2a, alpha: 0.32, blend: 'normal' },
  { id: 'ink', tint: 0xffffff, alpha: 0.93, blend: 'normal' },
  { id: 'shade', tint: 0xffffff, alpha: 0.85, blend: 'normal' },
  { id: 'stencil', tint: 0xffffff, alpha: 0.9, blend: 'normal' },
  { id: 'smudge', tint: 0xffffff, alpha: 0.75, blend: 'normal' },
  { id: 'fluid', tint: 0xffffff, alpha: 1, blend: 'normal' },
  { id: 'frost', tint: 0xffffff, alpha: 0.85, blend: 'normal' },
  { id: 'oil', tint: 0xffe7b0, alpha: 0.38, blend: 'add' },
  { id: 'gloss', tint: 0xfff6e6, alpha: 0.42, blend: 'add' },
  { id: 'wet', tint: 0xd8ecff, alpha: 0.2, blend: 'add' },
  { id: 'foam', tint: 0xffffff, alpha: 1, blend: 'normal' },
];

export interface Ptr {
  /** Tool tip in texture space. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Texture px per second. */
  speed: number;
  down: boolean;
}

export interface SubTool {
  id: string;
  label: string;
  icon: string;
}

export interface Step {
  title: string;
  hint: string;
  cursor?: TexName | null;
  tools?: SubTool[];
  tool?: string;
  enter?(): void;
  exit?(): void;
  update?(dt: number): void;
  down?(p: Ptr): void;
  move?(p: Ptr): void;
  up?(p: Ptr): void;
  select?(id: string): void;
  /** 0..1, step completes at 1. */
  progress(): number;
}

export interface Procedure {
  id: ToolId;
  steps: Step[];
  /** 0..1 quality of the whole procedure (timing, precision, cleanliness). */
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
  sfx(name: string): void;
  loop(name: string, on: boolean): void;
  haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'tick'): void;
}

// Cursor placement for each tool texture: anchor (tool tip), rotation, height in px.
const CURSORS: Partial<Record<TexName, { anchor: [number, number]; rot: number; h: number }>> = {
  bottle: { anchor: [0.5, 0], rot: Math.PI * 0.85, h: 120 },
  shampoo: { anchor: [0.5, 0], rot: Math.PI * 0.85, h: 120 },
  peroxide: { anchor: [0.5, 0], rot: Math.PI * 0.85, h: 120 },
  saline: { anchor: [0.5, 0], rot: Math.PI * 0.85, h: 120 },
  tube: { anchor: [0.5, 0], rot: Math.PI * 0.8, h: 110 },
  shower: { anchor: [0.4, 0.27], rot: 0, h: 120 },
  machine: { anchor: [0.5, 1], rot: 0.35, h: 140 },
  laser: { anchor: [0.5, 0.97], rot: 0.3, h: 140 },
  needle: { anchor: [0.5, 1], rot: 0.2, h: 120 },
  swab: { anchor: [0.5, 0.05], rot: Math.PI * 0.85, h: 120 },
  feather: { anchor: [0.5, 0.03], rot: Math.PI * 0.9, h: 150 },
  cotton: { anchor: [0.5, 0.5], rot: 0, h: 70 },
  gauze: { anchor: [0.5, 0.5], rot: 0, h: 70 },
  towel: { anchor: [0.5, 0.5], rot: 0, h: 80 },
  ice: { anchor: [0.5, 0.5], rot: 0, h: 80 },
  paper: { anchor: [0.5, 0.5], rot: 0, h: 80 },
};

const GRID_W = 50;
const RT_RES = 0.5;

class PaintLayer {
  rt: RenderTexture;
  mesh: Mesh;
  batch = new Container();
  pool: Sprite[] = [];
  used = 0;
  grid: Float32Array;

  constructor(
    public id: LayerId,
    geometry: MeshPlane['geometry'],
    texW: number,
    texH: number,
    gridLen: number,
  ) {
    this.rt = RenderTexture.create({ width: Math.ceil(texW * RT_RES), height: Math.ceil(texH * RT_RES) });
    this.mesh = new Mesh({ geometry, texture: this.rt });
    this.batch.scale.set(RT_RES);
    this.grid = new Float32Array(gridLen);
  }

  next(tex: Texture) {
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite(tex);
      s.anchor.set(0.5);
      this.pool.push(s);
      this.batch.addChild(s);
    }
    s.texture = tex;
    s.visible = true;
    this.used++;
    return s;
  }
}

interface Particle {
  s: Sprite | Text;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  grow: number;
  spin: number;
  fade: boolean;
  onEnd?: () => void;
}

interface Attached {
  s: Sprite | Container;
  x: number;
  y: number;
}

interface Tween {
  t: number;
  dur: number;
  fn: (k: number) => void;
  done?: () => void;
}

export const ease = {
  out: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};

// ---------------------------------------------------------------------------

export class Engine {
  app = new Application();
  T!: Textures;
  hooks: EngineHooks;

  world = new Container();
  stageC = new Container();
  skin!: MeshPlane;
  overlay = new Container();
  attachedC = new Container();
  fx = new Container();
  screenFx = new Container();
  cursor = new Sprite();
  maskMesh: Mesh | null = null;

  texW = 1000;
  texH = 1600;
  /** One "unit" = 1/1000 of texture width; all sizes in procedures use it. */
  u = 1;

  layers = {} as Record<LayerId, PaintLayer>;
  gridW = GRID_W;
  gridH = 80;
  cell = 20;
  maskGrid = new Uint8Array(0);
  maskCells: number[] = [];
  maskCenter = { x: 500, y: 800 };
  maskBox = { x0: 0, y0: 0, x1: 1000, y1: 1600 };

  // soft-body skin
  private vx = 28;
  private vy = 44;
  private base = new Float32Array(0);
  private off = new Float32Array(0);
  private vel = new Float32Array(0);
  private target = new Float32Array(0);
  private forces: { x: number; y: number; r: number; dx: number; dy: number; pinch: number }[] = [];

  private particles: Particle[] = [];
  private attached: Attached[] = [];
  private tweens: Tween[] = [];
  private shakeAmt = 0;
  private time = 0;
  private dirty = new Set<PaintLayer>();

  procedure: Procedure | null = null;
  stepIndex = 0;
  private stepDoneAt = 0;
  private finished = false;
  private lastView = '';

  ptr: Ptr = { x: 0, y: 0, dx: 0, dy: 0, speed: 0, down: false };
  private tipOffset = 0;
  private pointerInside = false;

  private unitAcc = 0;
  private unitTokens = 18;

  model: ModelDef | null = null;
  ready = false;
  /** Procedures expose key positions here for automated tests (?debug). */
  debug: Record<string, unknown> = {};
  private resizeObs?: ResizeObserver;

  constructor(hooks: EngineHooks) {
    this.hooks = hooks;
  }

  async init(el: HTMLElement) {
    await this.app.init({
      resizeTo: el,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    el.appendChild(this.app.canvas);
    this.T = createTextures();
    this.app.stage.addChild(this.world, this.screenFx, this.cursor);
    this.world.addChild(this.stageC);
    this.cursor.visible = false;

    const st = this.app.stage;
    st.eventMode = 'static';
    st.hitArea = this.app.screen;
    st.on('pointerdown', (e) => this.onDown(e));
    st.on('pointermove', (e) => this.onMove(e));
    st.on('pointerup', (e) => this.onUp(e));
    st.on('pointerupoutside', (e) => this.onUp(e));
    st.on('pointerleave', () => {
      this.pointerInside = false;
    });

    this.app.ticker.add((t) => this.update(Math.min(t.deltaMS / 1000, 0.05)));
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(el);
    this.ready = true;
  }

  destroy() {
    this.resizeObs?.disconnect();
    this.app.destroy(true, { children: true, texture: false });
  }

  // -------------------------------------------------------------------------
  // Model loading

  async loadModel(def: ModelDef) {
    this.model = def;
    this.setProcedure(null);
    this.stageC.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const l of Object.values(this.layers)) l.rt.destroy(true);
    this.particles = [];
    this.attached = [];
    this.tweens = [];

    const isVideo = /\.(mp4|webm)$/i.test(def.room);
    const tex: Texture = await Assets.load(isVideo ? { src: def.room, data: { loop: true, muted: true, autoPlay: true, playsinline: true } } : def.room);
    this.texW = tex.width;
    this.texH = tex.height;
    this.u = this.texW / 1000;

    this.vx = 28;
    this.vy = Math.max(12, Math.min(60, Math.round((28 * this.texH) / this.texW)));
    this.skin = new MeshPlane({ texture: tex, verticesX: this.vx, verticesY: this.vy });
    this.skin.autoResize = false;
    const pos = this.skin.geometry.positions;
    this.base = Float32Array.from(pos);
    this.off = new Float32Array(pos.length);
    this.vel = new Float32Array(pos.length);
    this.target = new Float32Array(pos.length);

    this.gridW = GRID_W;
    this.gridH = Math.round((GRID_W * this.texH) / this.texW);
    this.cell = this.texW / this.gridW;
    const gridLen = this.gridW * this.gridH;

    this.overlay = new Container();
    this.layers = {} as Record<LayerId, PaintLayer>;
    for (const d of LAYER_DEFS) {
      const l = new PaintLayer(d.id, this.skin.geometry, this.texW, this.texH, gridLen);
      l.mesh.tint = d.tint;
      l.mesh.alpha = d.alpha;
      l.mesh.blendMode = d.blend;
      this.layers[d.id] = l;
      this.overlay.addChild(l.mesh);
    }

    this.maskMesh = null;
    if (def.mask) {
      const maskTex: Texture = await Assets.load(def.mask);
      this.maskMesh = new Mesh({ geometry: this.skin.geometry, texture: maskTex });
      this.overlay.mask = this.maskMesh;
      await this.buildMaskGrid(def.mask);
    } else {
      this.maskGrid = new Uint8Array(gridLen).fill(1);
    }
    this.maskCells = [];
    let sx = 0;
    let sy = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < gridLen; i++) {
      if (!this.maskGrid[i]) continue;
      this.maskCells.push(i);
      const c = this.cellCenter(i);
      sx += c.x;
      sy += c.y;
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
    const n = Math.max(1, this.maskCells.length);
    this.maskCenter = { x: sx / n, y: sy / n };
    this.maskBox = { x0, y0, x1, y1 };

    this.attachedC = new Container();
    this.fx = new Container();
    this.stageC.addChild(this.skin, this.overlay);
    if (this.maskMesh) this.stageC.addChild(this.maskMesh);
    this.stageC.addChild(this.attachedC, this.fx);
    this.layout();
  }

  private async buildMaskGrid(src: string) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = this.gridW;
    cv.height = this.gridH;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.drawImage(img, 0, 0, this.gridW, this.gridH);
    const data = c.getImageData(0, 0, this.gridW, this.gridH).data;
    this.maskGrid = new Uint8Array(this.gridW * this.gridH);
    for (let i = 0; i < this.maskGrid.length; i++) this.maskGrid[i] = data[i * 4 + 3] > 128 && data[i * 4] > 128 ? 1 : 0;
  }

  private layout() {
    if (!this.skin) return;
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    const s = Math.max(W / this.texW, H / this.texH);
    this.stageC.scale.set(s);
    this.stageC.position.set((W - this.texW * s) / 2, (H - this.texH * s) / 2);
    this.world.pivot.set(W / 2, H / 2);
    this.world.position.set(W / 2, H / 2);
  }

  // -------------------------------------------------------------------------
  // Procedures

  setProcedure(p: Procedure | null) {
    const cur = this.procedure?.steps[this.stepIndex];
    cur?.exit?.();
    this.hooks.loop('*', false);
    this.procedure?.dispose?.();
    this.procedure = p;
    this.stepIndex = 0;
    this.stepDoneAt = 0;
    this.finished = false;
    this.lastView = '';
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
    const name = this.step?.cursor;
    const cfg = name ? CURSORS[name] : null;
    if (!name || !cfg) {
      this.cursor.visible = false;
      this.cursor.texture = this.T.soft;
      return;
    }
    const tex = this.T[name];
    this.cursor.texture = tex;
    this.cursor.anchor.set(cfg.anchor[0], cfg.anchor[1]);
    this.cursor.rotation = cfg.rot;
    this.cursor.scale.set(cfg.h / tex.height);
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
    if (this.stepIndex < p.steps.length - 1) {
      this.stepIndex++;
      this.step!.enter?.();
      this.applyCursor();
    } else {
      this.finished = true;
      this.cursor.visible = false;
      this.hooks.onFinish(p.id, p.accuracy());
      this.celebrate();
    }
    this.emitView(true);
  }

  // -------------------------------------------------------------------------
  // Input

  private toTex(gx: number, gy: number) {
    const p = this.stageC.toLocal({ x: gx, y: gy });
    return p;
  }

  private onDown(e: FederatedPointerEvent) {
    if (!e.isPrimary) return;
    this.tipOffset = e.pointerType === 'touch' ? 56 : 0;
    const t = this.toTex(e.global.x, e.global.y - this.tipOffset);
    this.ptr = { x: t.x, y: t.y, dx: 0, dy: 0, speed: 0, down: true };
    this.pointerInside = true;
    this.placeCursor(e.global.x, e.global.y);
    if (!this.finished) this.step?.down?.(this.ptr);
  }

  private lastMoveT = 0;
  private onMove(e: FederatedPointerEvent) {
    if (!e.isPrimary) return;
    this.pointerInside = true;
    if (e.pointerType !== 'touch') this.tipOffset = 0;
    this.placeCursor(e.global.x, e.global.y);
    const t = this.toTex(e.global.x, e.global.y - this.tipOffset);
    const now = performance.now();
    const dt = Math.max((now - this.lastMoveT) / 1000, 1 / 240);
    this.lastMoveT = now;
    const dx = t.x - this.ptr.x;
    const dy = t.y - this.ptr.y;
    const speed = Math.hypot(dx, dy) / dt;
    this.ptr = { x: t.x, y: t.y, dx, dy, speed: this.ptr.speed * 0.6 + speed * 0.4, down: this.ptr.down };
    if (this.ptr.down && !this.finished) this.step?.move?.(this.ptr);
  }

  private onUp(e: FederatedPointerEvent) {
    if (!e.isPrimary) return;
    this.ptr.down = false;
    if (!this.finished) this.step?.up?.(this.ptr);
  }

  private placeCursor(sx: number, sy: number) {
    this.cursor.position.set(sx, sy - this.tipOffset);
  }

  // -------------------------------------------------------------------------
  // Painting & coverage

  cellIndex(x: number, y: number) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.gridW || cy >= this.gridH) return -1;
    return cy * this.gridW + cx;
  }

  cellCenter(i: number) {
    return { x: ((i % this.gridW) + 0.5) * this.cell, y: (Math.floor(i / this.gridW) + 0.5) * this.cell };
  }

  inMask(x: number, y: number) {
    const i = this.cellIndex(x, y);
    return i >= 0 && this.maskGrid[i] === 1;
  }

  cellsInCircle(x: number, y: number, r: number, maskOnly = true) {
    const out: number[] = [];
    const c0 = Math.max(0, Math.floor((x - r) / this.cell));
    const c1 = Math.min(this.gridW - 1, Math.floor((x + r) / this.cell));
    const r0 = Math.max(0, Math.floor((y - r) / this.cell));
    const r1 = Math.min(this.gridH - 1, Math.floor((y + r) / this.cell));
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const i = cy * this.gridW + cx;
        if (maskOnly && !this.maskGrid[i]) continue;
        const c = this.cellCenter(i);
        if ((c.x - x) ** 2 + (c.y - y) ** 2 <= r * r) out.push(i);
      }
    return out;
  }

  cellsInPolygon(poly: { x: number; y: number }[]) {
    const out: number[] = [];
    for (let i = 0; i < this.gridW * this.gridH; i++) {
      const c = this.cellCenter(i);
      if (pointInPoly(c.x, c.y, poly)) out.push(i);
    }
    return out;
  }

  /** Stamp a brush into a layer. erase=true removes paint. Updates the coverage grid. */
  stamp(
    id: LayerId,
    x: number,
    y: number,
    r: number,
    o: { alpha?: number; tint?: number; tex?: TexName; erase?: boolean; rot?: number; gain?: number } = {},
  ) {
    const l = this.layers[id];
    if (!l) return;
    const s = l.next(this.T[o.tex ?? 'soft']);
    s.position.set(x, y);
    s.width = s.height = r * 2;
    s.rotation = o.rot ?? Math.random() * Math.PI * 2;
    s.alpha = o.alpha ?? 1;
    s.tint = o.tint ?? 0xffffff;
    s.blendMode = o.erase ? 'erase' : 'normal';
    this.dirty.add(l);

    const a = (o.alpha ?? 1) * (o.gain ?? 1.2);
    const g = l.grid;
    for (const i of this.cellsInCircle(x, y, r * 0.8, false)) g[i] = o.erase ? Math.max(0, g[i] - a * 1.3) : Math.min(1, g[i] + a);
  }

  /** Stamps along a segment with spacing proportional to brush size. */
  paintLine(id: LayerId, x0: number, y0: number, x1: number, y1: number, r: number, o: Parameters<Engine['stamp']>[4] = {}, spacing = 0.35) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / Math.max(1, r * spacing)));
    for (let k = 1; k <= n; k++) this.stamp(id, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r, o);
  }

  /** Fraction of cells (default: whole mask) with paint >= thr. */
  coverage(id: LayerId, cells: number[] = this.maskCells, thr = 0.5) {
    if (!cells.length) return 0;
    const g = this.layers[id].grid;
    let n = 0;
    for (const i of cells) if (g[i] >= thr) n++;
    return n / cells.length;
  }

  clearLayer(id: LayerId) {
    const l = this.layers[id];
    l.grid.fill(0);
    this.app.renderer.render({ container: new Container(), target: l.rt, clear: true });
  }

  /** Fade a layer by erasing it uniformly. */
  fadeLayer(id: LayerId, amount: number) {
    const l = this.layers[id];
    const s = l.next(this.T.hard);
    s.texture = this.T.hard;
    s.position.set(this.texW / 2, this.texH / 2);
    s.width = this.texW * 3;
    s.height = this.texH * 3;
    s.rotation = 0;
    s.tint = 0xffffff;
    s.alpha = amount;
    s.blendMode = 'erase';
    this.dirty.add(l);
    for (let i = 0; i < l.grid.length; i++) l.grid[i] = Math.max(0, l.grid[i] - amount);
  }

  private flushPaint() {
    for (const l of this.dirty) {
      this.app.renderer.render({ container: l.batch, target: l.rt, clear: false });
      for (let i = 0; i < l.used; i++) l.pool[i].visible = false;
      l.used = 0;
    }
    this.dirty.clear();
  }

  // -------------------------------------------------------------------------
  // Soft-body skin

  /** Push skin near (x,y) by (dx,dy) this frame. */
  force(x: number, y: number, r: number, dx: number, dy: number) {
    this.forces.push({ x, y, r, dx, dy, pinch: 0 });
  }

  /** Pull skin toward (x,y): a dent under a fingertip / needle. */
  pinch(x: number, y: number, r: number, strength: number) {
    this.forces.push({ x, y, r, dx: 0, dy: 0, pinch: strength });
  }

  /** Random velocity kick: twitch, flinch. */
  kick(x: number, y: number, r: number, amount: number) {
    const { base, vel } = this;
    for (let i = 0; i < base.length; i += 2) {
      const d2 = (base[i] - x) ** 2 + (base[i + 1] - y) ** 2;
      const f = Math.exp(-d2 / (r * r));
      if (f < 0.02) continue;
      vel[i] += (Math.random() - 0.5) * amount * f;
      vel[i + 1] += (Math.random() - 0.5) * amount * f;
    }
  }

  /** Skin displacement at a texture point (to keep attached things glued to the skin). */
  skinOffset(x: number, y: number) {
    const ix = Math.round((x / this.texW) * (this.vx - 1));
    const iy = Math.round((y / this.texH) * (this.vy - 1));
    if (ix < 0 || iy < 0 || ix >= this.vx || iy >= this.vy) return { x: 0, y: 0 };
    const k = (iy * this.vx + ix) * 2;
    return { x: this.off[k], y: this.off[k + 1] };
  }

  private updateSkin(dt: number) {
    const { base, off, vel, target, forces } = this;
    target.fill(0);
    for (const f of forces) {
      const r2 = f.r * f.r;
      for (let i = 0; i < base.length; i += 2) {
        const ex = base[i] - f.x;
        const ey = base[i + 1] - f.y;
        const d2 = ex * ex + ey * ey;
        if (d2 > r2 * 4) continue;
        const w = Math.exp(-d2 / r2);
        target[i] += f.dx * w - ex * f.pinch * w;
        target[i + 1] += f.dy * w - ey * f.pinch * w;
      }
    }
    forces.length = 0;
    const k = 220;
    const damp = Math.exp(-14 * dt);
    let moving = false;
    for (let i = 0; i < base.length; i++) {
      vel[i] = (vel[i] + (target[i] - off[i]) * k * dt) * damp;
      off[i] += vel[i] * dt;
      if (Math.abs(off[i]) > 0.01 || Math.abs(vel[i]) > 0.01) moving = true;
    }
    if (!moving) return;
    const pos = this.skin.geometry.positions;
    const bx = this.vx - 1;
    const by = this.vy - 1;
    for (let i = 0; i < base.length; i += 2) {
      // Keep the outer border fixed so the image never shows gaps.
      const v = i / 2;
      const gx = v % this.vx;
      const gy = Math.floor(v / this.vx);
      const edge = gx === 0 || gy === 0 || gx === bx || gy === by;
      pos[i] = base[i] + (edge ? 0 : off[i]);
      pos[i + 1] = base[i + 1] + (edge ? 0 : off[i + 1]);
    }
    this.skin.geometry.getBuffer('aPosition').update();
  }

  // -------------------------------------------------------------------------
  // Sprites, particles, tweens

  sprite(tex: TexName, x: number, y: number, size: number, o: { anchor?: [number, number]; tint?: number; alpha?: number; rot?: number } = {}) {
    const s = new Sprite(this.T[tex]);
    s.anchor.set(...(o.anchor ?? [0.5, 0.5]));
    s.position.set(x, y);
    s.scale.set(size / s.texture.width);
    s.tint = o.tint ?? 0xffffff;
    s.alpha = o.alpha ?? 1;
    s.rotation = o.rot ?? 0;
    return s;
  }

  /** Adds a sprite that moves with the deforming skin. */
  attach<T extends Sprite | Container>(s: T, x: number, y: number) {
    this.attached.push({ s, x, y });
    this.attachedC.addChild(s);
    return s;
  }

  detach(s: Sprite | Container) {
    this.attached = this.attached.filter((a) => a.s !== s);
    s.destroy();
  }

  moveAttached(s: Sprite | Container, x: number, y: number) {
    const a = this.attached.find((q) => q.s === s);
    if (a) {
      a.x = x;
      a.y = y;
    }
  }

  particle(
    tex: TexName,
    x: number,
    y: number,
    size: number,
    o: Partial<Omit<Particle, 's'>> & { tint?: number; alpha?: number; rot?: number; blend?: 'add' | 'normal' } = {},
  ) {
    const s = this.sprite(tex, x, y, size, { tint: o.tint, alpha: o.alpha, rot: o.rot ?? Math.random() * 6.28 });
    if (o.blend) s.blendMode = o.blend;
    this.fx.addChild(s);
    this.particles.push({ s, vx: o.vx ?? 0, vy: o.vy ?? 0, g: o.g ?? 0, life: 0, max: o.max ?? 1, grow: o.grow ?? 0, spin: o.spin ?? 0, fade: o.fade ?? true, onEnd: o.onEnd });
    return s;
  }

  floatText(x: number, y: number, text: string, color = 0xffffff, size = 46) {
    const t = new Text({
      text,
      style: { fontFamily: 'Outfit, sans-serif', fontSize: size * this.u, fontWeight: '800', fill: color, stroke: { color: 0x000000, width: 5 * this.u } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fx.addChild(t);
    this.particles.push({ s: t, vx: (Math.random() - 0.5) * 40 * this.u, vy: -160 * this.u, g: 60 * this.u, life: 0, max: 1.1, grow: 0.2, spin: 0, fade: true });
  }

  ripple(x: number, y: number, color = 0xffffff, size = 60) {
    this.particle('ring', x, y, size * this.u, { tint: color, grow: 2.2, max: 0.5, rot: 0 });
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

  /** Random point inside the mask, at least minDist from `avoid`. */
  randomMaskPoint(avoid: { x: number; y: number }[] = [], minDist = 0, box?: { y0: number; y1: number }) {
    for (let tries = 0; tries < 200; tries++) {
      const i = this.maskCells[Math.floor(Math.random() * this.maskCells.length)];
      if (i === undefined) break;
      const c = this.cellCenter(i);
      if (box && (c.y < box.y0 || c.y > box.y1)) continue;
      // Stay away from the mask border.
      if (this.cellsInCircle(c.x, c.y, this.cell * 2.2).length < 13) continue;
      if (avoid.every((a) => Math.hypot(a.x - c.x, a.y - c.y) >= minDist)) return c;
    }
    return { ...this.maskCenter };
  }

  private celebrate() {
    const { x, y } = this.maskCenter;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (200 + Math.random() * 400) * this.u;
      this.particle(i % 3 ? 'sparkle' : 'heart', x, y, (20 + Math.random() * 30) * this.u, {
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 200 * this.u,
        g: 500 * this.u,
        max: 1.3,
        spin: 3,
        blend: i % 3 ? 'add' : 'normal',
        tint: i % 3 ? 0xfff3b0 : 0xffffff,
      });
    }
    this.hooks.sfx('success');
    this.hooks.haptic('success');
  }

  // -------------------------------------------------------------------------

  private update(dt: number) {
    if (!this.skin) return;
    this.time += dt;

    this.ptr.speed *= Math.exp(-6 * dt);
    const step = this.finished ? null : this.step;
    step?.update?.(dt);
    this.updateSkin(dt);
    this.flushPaint();

    for (const a of this.attached) {
      const o = this.skinOffset(a.x, a.y);
      a.s.position.set(a.x + o.x, a.y + o.y);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.vy += p.g * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      if (p.grow) p.s.scale.set(p.s.scale.x * (1 + p.grow * dt));
      if (p.fade) p.s.alpha = Math.max(0, 1 - (p.life / p.max) ** 2);
      if (p.life >= p.max) {
        p.onEnd?.();
        p.s.destroy();
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

    // camera: shake + gentle breathing zoom
    this.shakeAmt *= Math.exp(-8 * dt);
    const b = 1 + Math.sin(this.time * 1.3) * 0.004;
    this.world.scale.set(b);
    this.world.position.set(
      this.app.screen.width / 2 + (Math.random() - 0.5) * this.shakeAmt,
      this.app.screen.height / 2 + (Math.random() - 0.5) * this.shakeAmt,
    );

    // cursor: visible while touching (or hovering with a mouse)
    const hasCursor = !!step?.cursor;
    this.cursor.visible = hasCursor && (this.ptr.down || (this.pointerInside && this.tipOffset === 0));

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
  }
}

export function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPath(x: number, y: number, pts: { x: number; y: number }[]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(a.x + vx * t - x, a.y + vy * t - y));
  }
  return best;
}
