/**
 * Particles around the camera: marine snow, plankton (bioluminescent when
 * disturbed in the dark) and bubbles. Bubbles rise at the terminal velocity of
 * a ~2–5 mm bubble (≈ 0.25 m/s, Clift et al. 1978) and grow as they rise,
 * radius ∝ (p₀/p)^(1/3) by Boyle's law.
 */
import * as THREE from "three";
import { patchMaterial } from "./water";

const BOX = 50;

function discTexture(soft: boolean, ring = false) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (ring) {
    grd.addColorStop(0, "rgba(255,255,255,0.05)");
    grd.addColorStop(0.7, "rgba(255,255,255,0.25)");
    grd.addColorStop(0.85, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(soft ? 0.25 : 0.6, "rgba(255,255,255,0.6)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Cloud {
  readonly points: THREE.Points;
  readonly pos: Float32Array;
  constructor(n: number, mat: THREE.PointsMaterial) {
    this.pos = new Float32Array(n * 3);
    for (let i = 0; i < this.pos.length; i++) this.pos[i] = (Math.random() - 0.5) * BOX;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }
  /** Keep points in a box around `c`, drifting with `drift` (world m/s). */
  update(c: THREE.Vector3, drift: THREE.Vector3, dt: number, maxY = 0) {
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += drift.x * dt; p[i + 1] += drift.y * dt; p[i + 2] += drift.z * dt;
      for (let a = 0; a < 3; a++) {
        const cc = a === 0 ? c.x : a === 1 ? c.y : c.z;
        if (p[i + a] > cc + BOX / 2) p[i + a] -= BOX;
        if (p[i + a] < cc - BOX / 2) p[i + a] += BOX;
      }
      if (p[i + 1] > maxY) p[i + 1] = maxY - Math.random() * 2;
    }
    this.points.geometry.getAttribute("position").needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private snow: Cloud;
  private plankton: Cloud;
  private glowMat: THREE.PointsMaterial;
  private snowMat: THREE.PointsMaterial;
  private bubbles: THREE.Points;
  private bPos: Float32Array;
  private bSize: Float32Array;
  private bLife: Float32Array;
  private bNext = 0;
  private readonly NB = 600;

  constructor() {
    this.snowMat = new THREE.PointsMaterial({ color: 0xcfd6c8, size: 0.05, map: discTexture(false), transparent: true, depthWrite: false, opacity: 0.8 });
    patchMaterial(this.snowMat, false);
    this.snow = new Cloud(3000, this.snowMat);
    this.glowMat = new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.035, map: discTexture(true), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.plankton = new Cloud(1500, this.glowMat);
    this.bPos = new Float32Array(this.NB * 3).fill(-1e6);
    this.bSize = new Float32Array(this.NB);
    this.bLife = new Float32Array(this.NB);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.bPos, 3));
    g.setAttribute("size", new THREE.BufferAttribute(this.bSize, 1));
    const bmat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: discTexture(false, true) }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float size; uniform float uScale;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: "uniform sampler2D uTex; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(0.85,0.95,1.0), t.a * 0.9); }",
    });
    this.bubbles = new THREE.Points(g, bmat);
    this.bubbles.frustumCulled = false;
    this.group.add(this.snow.points, this.plankton.points, this.bubbles);
  }

  /** Emit n bubbles at a world point with an initial velocity spread. */
  emit(at: THREE.Vector3, n: number, radius = 0.003) {
    for (let k = 0; k < n; k++) {
      const i = this.bNext++ % this.NB;
      this.bPos[i * 3] = at.x + (Math.random() - 0.5) * 0.4;
      this.bPos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.4;
      this.bPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.4;
      this.bSize[i] = radius * (0.6 + Math.random() * 0.8);
      this.bLife[i] = 20;
    }
  }

  update(cam: THREE.Vector3, subVel: THREE.Vector3, dt: number, o: { brightness: number; lightsOn: boolean; depth: number; t: number }) {
    // particles are ~at rest in the water; the craft moves through them
    const drift = new THREE.Vector3(0, -0.01, 0); // marine snow sinks ~1 cm/s (≈ 10–100 m/day)
    this.snow.update(cam, drift, dt, -0.2);
    this.plankton.update(cam, new THREE.Vector3(Math.sin(o.t * 0.3) * 0.02, 0, Math.cos(o.t * 0.2) * 0.02), dt, -0.2);
    this.snowMat.opacity = Math.min(0.85, 0.1 + o.brightness * 0.8 + (o.lightsOn ? 0.5 : 0));
    this.snowMat.size = 0.04 + Math.min(0.04, o.depth / 50000);
    // bioluminescent plankton flashes when the craft moves fast in the dark
    const speed = subVel.length();
    this.glowMat.opacity = o.brightness < 0.2 ? Math.min(1, 0.15 + speed * 0.8) * (0.6 + 0.4 * Math.sin(o.t * 7)) : 0.05;
    this.glowMat.color.setHex(o.depth < 200 ? 0xbfe6d8 : 0x5fe8ff);

    // bubbles: rise ≈ 0.25 m/s, expand with falling pressure, pop at the surface
    const p = this.bPos;
    for (let i = 0; i < this.NB; i++) {
      if (this.bLife[i] <= 0) continue;
      const y = p[i * 3 + 1];
      const depth = Math.max(-y, 0);
      const r0 = this.bSize[i];
      p[i * 3 + 1] += 0.25 * dt;
      p[i * 3] += Math.sin(o.t * 9 + i) * 0.05 * dt; // zig-zag of ellipsoidal bubbles
      const pAbs = 101325 + 10090 * depth;
      const pNew = 101325 + 10090 * Math.max(depth - 0.25 * dt, 0);
      this.bSize[i] = Math.min(r0 * Math.cbrt(pAbs / pNew), 0.03);
      this.bLife[i] -= dt;
      if (p[i * 3 + 1] >= 0 || this.bLife[i] <= 0) { this.bLife[i] = 0; p[i * 3 + 1] = -1e6; }
    }
    this.bubbles.geometry.getAttribute("position").needsUpdate = true;
    this.bubbles.geometry.getAttribute("size").needsUpdate = true;
  }
}
