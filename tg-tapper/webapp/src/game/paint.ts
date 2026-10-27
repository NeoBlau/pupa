// Paint layers in the foot's UV space. 12 grayscale layers are packed into the RGBA
// channels of 3 render targets; the skin shader turns them into colour, gloss and wetness.

import * as THREE from 'three';
import type { TexName, Textures } from './textures.ts';

export type LayerId = 'redness' | 'ink' | 'shade' | 'stencil' | 'smudge' | 'blood' | 'pus' | 'frost' | 'oil' | 'gloss' | 'wet' | 'foam';

const SLOTS: Record<LayerId, [number, number]> = {
  redness: [0, 0],
  ink: [0, 1],
  shade: [0, 2],
  stencil: [0, 3],
  smudge: [1, 0],
  blood: [1, 1],
  pus: [1, 2],
  frost: [1, 3],
  oil: [2, 0],
  gloss: [2, 1],
  wet: [2, 2],
  foam: [2, 3],
};

const CHANNEL = [new THREE.Vector4(1, 0, 0, 0), new THREE.Vector4(0, 1, 0, 0), new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 0, 1)];

const RT_SIZE = 2048;
export const GRID = 64;

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const frag = /* glsl */ `
uniform sampler2D map;
uniform vec4 mask;
uniform float alpha;
varying vec2 vUv;
void main() { gl_FragColor = mask * (texture2D(map, vUv).a * alpha); }`;

export interface StampOpts {
  alpha?: number;
  tex?: TexName;
  erase?: boolean;
  rot?: number;
  /** How fast the coverage grid fills, relative to alpha. */
  gain?: number;
}

export class Paint {
  rts: THREE.WebGLRenderTarget[];
  private scenes: THREE.Scene[] = [];
  private pools: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[][] = [[], [], []];
  private used = [0, 0, 0];
  private cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private plane = new THREE.PlaneGeometry(1, 1);
  private brushes = new Map<string, THREE.Texture>();
  private white: THREE.Texture;
  private fadeAcc = new Map<LayerId, number>();

  grids = {} as Record<LayerId, Float32Array>;
  valid = new Uint8Array(GRID * GRID);
  validCells: number[] = [];
  /** World position of each grid cell (average of the vertices mapped into it). */
  cellPos = new Float32Array(GRID * GRID * 3);

  constructor(
    private renderer: THREE.WebGLRenderer,
    private textures: Textures,
    geometry: THREE.BufferGeometry,
    public uvPerMeter: number,
  ) {
    this.rts = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, { depthBuffer: false, generateMipmaps: false }));
    this.scenes = [0, 1, 2].map(() => new THREE.Scene());
    const d = new Uint8Array([255, 255, 255, 255]);
    this.white = new THREE.DataTexture(d, 1, 1);
    this.white.needsUpdate = true;
    for (const id of Object.keys(SLOTS) as LayerId[]) this.grids[id] = new Float32Array(GRID * GRID);
    for (const rt of this.rts) this.clearRT(rt);
    this.buildGrid(geometry);
  }

  private buildGrid(g: THREE.BufferGeometry) {
    const uv = g.attributes.uv;
    const pos = g.attributes.position;
    const mask = g.attributes.paintMask;
    const count = new Uint16Array(GRID * GRID);
    for (let i = 0; i < uv.count; i++) {
      if (mask && mask.getX(i) < 0.5) continue;
      const c = this.cellOf(uv.getX(i), uv.getY(i));
      if (c < 0) continue;
      count[c]++;
      this.cellPos[c * 3] += pos.getX(i);
      this.cellPos[c * 3 + 1] += pos.getY(i);
      this.cellPos[c * 3 + 2] += pos.getZ(i);
    }
    for (let c = 0; c < GRID * GRID; c++) {
      if (!count[c]) continue;
      this.valid[c] = 1;
      this.validCells.push(c);
      for (let k = 0; k < 3; k++) this.cellPos[c * 3 + k] /= count[c];
    }
  }

  cellOf(u: number, v: number) {
    const x = Math.floor(u * GRID);
    const y = Math.floor(v * GRID);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return -1;
    return y * GRID + x;
  }

  cellWorld(c: number, out = new THREE.Vector3()) {
    return out.set(this.cellPos[c * 3], this.cellPos[c * 3 + 1], this.cellPos[c * 3 + 2]);
  }

  cellsInSphere(p: THREE.Vector3, r: number) {
    const out: number[] = [];
    const r2 = r * r;
    for (const c of this.validCells) {
      const dx = this.cellPos[c * 3] - p.x;
      const dy = this.cellPos[c * 3 + 1] - p.y;
      const dz = this.cellPos[c * 3 + 2] - p.z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(c);
    }
    return out;
  }

  private brush(name: TexName) {
    let t = this.brushes.get(name);
    if (!t) {
      t = new THREE.CanvasTexture(this.textures[name]);
      this.brushes.set(name, t);
    }
    return t;
  }

  private next(rt: number) {
    let m = this.pools[rt][this.used[rt]];
    if (!m) {
      m = new THREE.Mesh(
        this.plane,
        new THREE.ShaderMaterial({
          vertexShader: vert,
          fragmentShader: frag,
          uniforms: { map: { value: null }, mask: { value: new THREE.Vector4() }, alpha: { value: 1 } },
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneFactor,
          blendSrcAlpha: THREE.OneFactor,
          blendDstAlpha: THREE.OneFactor,
        }),
      );
      this.pools[rt].push(m);
      this.scenes[rt].add(m);
    }
    m.visible = true;
    this.used[rt]++;
    return m;
  }

  /** Stamp a brush at a UV position. r is in world metres. */
  stamp(layer: LayerId, uv: THREE.Vector2, r: number, o: StampOpts = {}) {
    const [rt, ch] = SLOTS[layer];
    const ru = r * this.uvPerMeter;
    const m = this.next(rt);
    m.position.set(uv.x, uv.y, 0);
    m.scale.set(ru * 2, ru * 2, 1);
    m.rotation.z = o.rot ?? Math.random() * Math.PI * 2;
    const u = m.material.uniforms;
    u.map.value = this.brush(o.tex ?? 'soft');
    u.mask.value.copy(CHANNEL[ch]);
    u.alpha.value = o.alpha ?? 1;
    const eq = o.erase ? THREE.ReverseSubtractEquation : THREE.AddEquation;
    m.material.blendEquation = eq;
    m.material.blendEquationAlpha = eq;

    const a = (o.alpha ?? 1) * (o.gain ?? 1.2);
    const g = this.grids[layer];
    const rc = ru * 0.8 * GRID;
    const cx = uv.x * GRID;
    const cy = uv.y * GRID;
    for (let y = Math.max(0, Math.floor(cy - rc)); y <= Math.min(GRID - 1, Math.floor(cy + rc)); y++)
      for (let x = Math.max(0, Math.floor(cx - rc)); x <= Math.min(GRID - 1, Math.floor(cx + rc)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > rc * rc) continue;
        const c = y * GRID + x;
        g[c] = o.erase ? Math.max(0, g[c] - a * 1.3) : Math.min(1, g[c] + a);
      }
  }

  /** Uniformly remove `amount` (0..1) of a layer. Small amounts are accumulated (8-bit targets). */
  fade(layer: LayerId, amount: number) {
    const acc = (this.fadeAcc.get(layer) ?? 0) + amount;
    if (acc < 3 / 255) {
      this.fadeAcc.set(layer, acc);
      return;
    }
    this.fadeAcc.set(layer, 0);
    const [rt, ch] = SLOTS[layer];
    const m = this.next(rt);
    m.position.set(0.5, 0.5, 0);
    m.scale.set(1, 1, 1);
    m.rotation.z = 0;
    m.material.uniforms.map.value = this.white;
    m.material.uniforms.mask.value.copy(CHANNEL[ch]);
    m.material.uniforms.alpha.value = acc;
    m.material.blendEquation = THREE.ReverseSubtractEquation;
    m.material.blendEquationAlpha = THREE.ReverseSubtractEquation;
    const g = this.grids[layer];
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, g[i] - acc);
  }

  clear(layer: LayerId) {
    this.fade(layer, 1);
    this.grids[layer].fill(0);
  }

  coverage(layer: LayerId, cells: number[] = this.validCells, thr = 0.5) {
    if (!cells.length) return 0;
    const g = this.grids[layer];
    let n = 0;
    for (const c of cells) if (g[c] >= thr) n++;
    return n / cells.length;
  }

  amountAt(layer: LayerId, uv: THREE.Vector2) {
    const c = this.cellOf(uv.x, uv.y);
    return c < 0 ? 0 : this.grids[layer][c];
  }

  private clearRT(rt: THREE.WebGLRenderTarget) {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(prev);
  }

  flush() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    for (let i = 0; i < 3; i++) {
      if (!this.used[i]) continue;
      r.setRenderTarget(this.rts[i]);
      r.render(this.scenes[i], this.cam);
      for (let k = 0; k < this.used[i]; k++) this.pools[i][k].visible = false;
      this.used[i] = 0;
    }
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
  }

  dispose() {
    for (const rt of this.rts) rt.dispose();
    for (const p of this.pools) for (const m of p) m.material.dispose();
    for (const t of this.brushes.values()) t.dispose();
  }
}

/** Patches the skin material so paint layers change colour, gloss and wetness. */
export function patchSkinMaterial(mat: THREE.MeshPhysicalMaterial, paint: Paint) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint0 = { value: paint.rts[0].texture };
    sh.uniforms.uPaint1 = { value: paint.rts[1].texture };
    sh.uniforms.uPaint2 = { value: paint.rts[2].texture };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paintMask;\nvarying float vPaintMask;\nvarying vec2 vPaintUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPaintUv = uv;\nvPaintMask = paintMask;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uPaint0, uPaint1, uPaint2;\nvarying float vPaintMask;\nvarying vec2 vPaintUv;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec4 P0 = clamp(texture2D(uPaint0, vPaintUv), 0.0, 1.0) * vPaintMask;
        vec4 P1 = clamp(texture2D(uPaint1, vPaintUv), 0.0, 1.0) * vPaintMask;
        vec4 P2 = clamp(texture2D(uPaint2, vPaintUv), 0.0, 1.0) * vPaintMask;
        vec3 col = diffuseColor.rgb;
        col = mix(col, col * vec3(1.0, 0.5, 0.45) + vec3(0.1, 0.0, 0.0), P0.r * 0.8);   // redness
        col = mix(col, col * vec3(0.22, 0.2, 0.26), P0.b * 0.85);                        // shading
        col = mix(col, vec3(0.025, 0.02, 0.04), P0.g * 0.96);                            // ink
        col = mix(col, vec3(0.38, 0.14, 0.8), P0.a * 0.85);                              // stencil
        col = mix(col, vec3(0.08, 0.06, 0.1), P1.r * 0.7);                               // smudge
        col = mix(col, vec3(0.3, 0.005, 0.015), P1.g);                                   // blood
        col = mix(col, vec3(0.85, 0.72, 0.34), P1.b);                                    // pus
        col = mix(col, vec3(0.95, 0.95, 0.98), P1.a * 0.85);                             // laser frost
        col *= 1.0 - P2.b * 0.12;                                                        // wet skin darkens
        col = mix(col, col * vec3(1.06, 0.96, 0.78) + 0.015, P2.r * 0.4);                // oil tint
        col = mix(col, vec3(0.97, 0.97, 1.0), P2.a);                                     // foam
        diffuseColor.rgb = col;
        float shine = clamp(P2.r + P2.g + P2.b + P1.g * 0.8 + P1.b * 0.6, 0.0, 1.0);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, shine);\nroughnessFactor = mix(roughnessFactor, 0.85, P2.a);',
      )
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = shine;\nmaterial.clearcoatRoughness = 0.05;\n#endif',
      )
      // Cheap subsurface scattering: warm light bleeding through the skin.
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.32, 0.08, 0.05) * (1.0 - P2.a);');
  };
}
