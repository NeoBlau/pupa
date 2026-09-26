/**
 * 3D view from the submersible's viewport (Three.js).
 *
 * What is physical here: water colour and ambient brightness come from the
 * spectral light model (optics.ts); the surface is synthesised from the wave
 * spectrum (waves.ts); the vehicle's motion comes from the dynamics.
 * What is illustrative: marine snow density, seafloor texture, organism
 * sprites and bioluminescent flashes — they convey the environment, they are
 * not data.
 */
import * as THREE from "three";
import type { WaveComponent } from "../science/waves";

export interface ViewState {
  z: number; // m
  altitude: number; // m above the seafloor
  w: number; u: number; v: number; // m/s
  t: number; // s
  waterRGB: [number, number, number];
  luminance: number; // relative to surface
  lightsOn: boolean;
  waves: WaveComponent[];
  vents: boolean;
  bioRate: number; // flashes per second (illustrative)
}

/**
 * Display brightness from relative luminance. The eye spans ~10 orders of
 * magnitude; we map 1 → 1 and 1e-7 → 0 logarithmically (scotopic threshold
 * for a dark-adapted human is roughly 1e-6…1e-7 of daylight).
 */
export const displayBrightness = (lum: number) => Math.pow(Math.min(1, Math.max(0, (Math.log10(Math.max(lum, 1e-12)) + 7) / 7)), 1.4);

const SNOW = 2500;
const BOX = 40;

export class DiveScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private fog = new THREE.FogExp2(0x000000, 0.03);
  private ambient = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  private spot: THREE.SpotLight;
  private snow: THREE.Points;
  private snowPos: Float32Array;
  private floor: THREE.Mesh;
  private surface: THREE.Mesh;
  private surfaceBase: Float32Array;
  private vents = new THREE.Group();
  private plume: THREE.Points;
  private flashes: THREE.Sprite[] = [];
  private creatures: Array<{ sprite: THREE.Sprite; born: number; life: number; vel: THREE.Vector3 }> = [];
  private glowTex: THREE.Texture;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, -0.35, -1);
    this.scene.fog = this.fog;
    this.scene.add(this.ambient);

    this.spot = new THREE.SpotLight(0xfff4e0, 60, 45, Math.PI / 5, 0.5, 1.6);
    this.spot.position.set(0, -0.5, 0);
    this.spot.target.position.set(0, -6, -14);
    this.scene.add(this.spot, this.spot.target);

    this.glowTex = makeGlowTexture();

    // marine snow
    this.snowPos = new Float32Array(SNOW * 3);
    for (let i = 0; i < SNOW * 3; i++) this.snowPos[i] = (Math.random() - 0.5) * BOX;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8dccf, size: 0.06, transparent: true, opacity: 0.8 }));
    this.scene.add(this.snow);

    // seafloor
    const fg = new THREE.PlaneGeometry(400, 400, 160, 160);
    fg.rotateX(-Math.PI / 2);
    const pos = fg.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), zz = pos.getZ(i);
      pos.setY(i, 1.5 * Math.sin(x * 0.05) * Math.cos(zz * 0.04) + 0.6 * Math.sin(x * 0.23 + zz * 0.17) + 0.25 * Math.sin(x * 0.9) * Math.sin(zz * 0.7));
    }
    fg.computeVertexNormals();
    this.floor = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0x8a8272, roughness: 1 }));
    this.scene.add(this.floor);

    // hydrothermal chimneys + dark plume (TAG mission)
    for (let i = 0; i < 5; i++) {
      const h = 6 + Math.random() * 10;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.8, h, 12), new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 1 }));
      c.position.set((i - 2) * 5 + (Math.random() - 0.5) * 2, h / 2, -9 - Math.random() * 10);
      this.vents.add(c);
    }
    const pp = new Float32Array(1500 * 3);
    this.plume = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pp, 3)), new THREE.PointsMaterial({ color: 0x57504a, size: 0.9, transparent: true, opacity: 0.55, depthWrite: false }));
    this.vents.add(this.plume);
    this.scene.add(this.vents);

    // sea surface seen from below
    const sg = new THREE.PlaneGeometry(300, 300, 96, 96);
    sg.rotateX(Math.PI / 2);
    this.surfaceBase = Float32Array.from((sg.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    this.surface = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xbfe6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, fog: true }));
    this.scene.add(this.surface);

    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x5fe8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.scale.setScalar(0.6);
      this.scene.add(s);
      this.flashes.push(s);
    }
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Show an organism crossing the view for a few seconds. */
  spawnCreature(color: string, glow: boolean, size = 1.2) {
    const tex = makeCreatureTexture(color, glow);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const dir = Math.random() < 0.5 ? -1 : 1;
    sprite.position.set(-dir * 12, -2 + Math.random() * 3, -8 - Math.random() * 6);
    sprite.scale.set(size * 2, size, 1);
    if (dir < 0) sprite.material.rotation = 0; else sprite.scale.x *= -1;
    this.scene.add(sprite);
    this.creatures.push({ sprite, born: performance.now(), life: 9000, vel: new THREE.Vector3(dir * 2.6, 0.1, 0) });
  }

  render(v: ViewState, dtReal: number) {
    const bright = displayBrightness(v.luminance);
    const water = new THREE.Color(v.waterRGB[0], v.waterRGB[1], v.waterRGB[2]).multiplyScalar(bright * 0.55);
    this.scene.background = water;
    this.fog.color.copy(water);
    // Visual attenuation: clear open-ocean water, beam visibility ~25–40 m.
    this.fog.density = 0.035;
    this.ambient.color.setRGB(v.waterRGB[0], v.waterRGB[1], v.waterRGB[2]);
    this.ambient.intensity = 2.2 * bright;
    this.spot.visible = v.lightsOn;

    // marine snow drifts past opposite to vehicle motion (camera-relative)
    const dt = Math.min(dtReal, 0.1);
    for (let i = 0; i < SNOW; i++) {
      const k = i * 3;
      this.snowPos[k] -= v.u * dt * 3;
      this.snowPos[k + 1] += (v.w + 0.02) * dt * 3;
      this.snowPos[k + 2] += v.v * dt * 3;
      for (let a = 0; a < 3; a++) {
        if (this.snowPos[k + a] > BOX / 2) this.snowPos[k + a] -= BOX;
        if (this.snowPos[k + a] < -BOX / 2) this.snowPos[k + a] += BOX;
      }
    }
    this.snow.geometry.getAttribute("position").needsUpdate = true;
    const snowMat = this.snow.material as THREE.PointsMaterial;
    snowMat.opacity = Math.min(0.9, 0.15 + bright + (v.lightsOn ? 0.5 : 0));

    // seafloor
    this.floor.visible = v.altitude < 200;
    this.floor.position.y = -v.altitude - 2;
    this.vents.visible = v.vents && v.altitude < 200;
    this.vents.position.y = -v.altitude - 2;
    if (this.vents.visible) {
      const arr = (this.plume.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const chim = this.vents.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
      for (let i = 0; i < arr.length / 3; i++) {
        const c = chim[i % chim.length];
        const age = ((v.t * 0.8 + i * 0.37) % 30);
        const spread = 0.3 + age * 0.25;
        arr[i * 3] = c.position.x + Math.sin(i * 12.9898) * spread;
        arr[i * 3 + 1] = c.position.y + (c.geometry as THREE.CylinderGeometry).parameters.height / 2 + age * 1.2;
        arr[i * 3 + 2] = c.position.z + Math.cos(i * 78.233) * spread;
      }
      this.plume.geometry.getAttribute("position").needsUpdate = true;
    }

    // sea surface synthesised from the wave spectrum
    this.surface.visible = v.z < 120;
    if (this.surface.visible) {
      this.surface.position.y = v.z;
      const pos = this.surface.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = this.surfaceBase[i * 3], zz = this.surfaceBase[i * 3 + 2];
        let eta = 0;
        for (const c of v.waves) eta += c.amp * Math.cos(c.k * (x * Math.cos(c.dir) + zz * Math.sin(c.dir)) - c.omega * v.t + c.phase);
        pos.setY(i, eta);
      }
      pos.needsUpdate = true;
      (this.surface.material as THREE.MeshBasicMaterial).color.setRGB(0.75, 0.9, 1).multiplyScalar(0.4 + 0.6 * bright);
    }

    // bioluminescence (illustrative): only visible when ambient light is low
    for (const f of this.flashes) {
      const m = f.material as THREE.SpriteMaterial;
      m.opacity *= Math.exp(-dt * 3);
      if (bright < 0.25 && Math.random() < v.bioRate * dt / this.flashes.length * 10) {
        f.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 16, -5 - Math.random() * 25);
        m.opacity = 1;
      }
    }

    const now = performance.now();
    this.creatures = this.creatures.filter((c) => {
      const age = now - c.born;
      c.sprite.position.addScaledVector(c.vel, dt);
      c.sprite.position.y += v.w * dt * 3;
      (c.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, age / 800, (c.life - age) / 800);
      if (age > c.life) { this.scene.remove(c.sprite); c.sprite.material.map?.dispose(); c.sprite.material.dispose(); return false; }
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  }

  snapshot(): string {
    return this.canvas.toDataURL("image/png");
  }
}

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.5)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Simple silhouette; the HUD card carries the real identification. */
function makeCreatureTexture(color: string, glow: boolean): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d")!;
  if (glow) { g.shadowColor = color; g.shadowBlur = 24; }
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(120, 64, 80, 28, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(195, 64); g.lineTo(245, 30); g.lineTo(245, 98); g.closePath();
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.7)";
  g.beginPath(); g.arc(70, 58, 6, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
