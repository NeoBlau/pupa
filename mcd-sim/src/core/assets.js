// Загрузка ассетов: модели glTF (Poly Haven, Sketchfab, three.js), PBR-текстуры, кэш материалов.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = import.meta.env.BASE_URL + 'assets/';

class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.texLoader = new THREE.TextureLoader();
    this.models = new Map();
    this.textures = new Map();
    this.materials = new Map();
    this.sketchfab = new Set();
    this.renderer = null;
    this.missing = new Set();
  }

  async init(renderer) {
    this.renderer = renderer;
    try {
      const r = await fetch(BASE + 'sketchfab/manifest.json');
      if (r.ok) (await r.json()).models.forEach((m) => this.sketchfab.add(m));
    } catch { /* нет манифеста — нет моделей Sketchfab */ }
  }

  hasSketchfab(key) { return !!key && this.sketchfab.has(key); }

  async loadGLB(url) {
    if (this.models.has(url)) return this.models.get(url);
    const p = new Promise((res) => {
      this.loader.load(url, (g) => res(g), undefined, (e) => { console.warn('Не удалось загрузить', url, e); this.missing.add(url); res(null); });
    });
    this.models.set(url, p);
    return p;
  }

  model(name) { return this.loadGLB(BASE + 'models/' + name + '.glb'); }
  sketch(key) { return this.hasSketchfab(key) ? this.loadGLB(BASE + 'sketchfab/' + key + '.glb') : Promise.resolve(null); }
  person(file) { return this.loadGLB(BASE + 'people/' + file); }

  tex(name, kind, repeat = 1) {
    const key = `${name}_${kind}`;
    let t = this.textures.get(key);
    if (!t) {
      t = this.texLoader.load(BASE + `textures/${name}_${kind}.webp`, undefined, undefined, () => this.missing.add(key));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 4;
      this.textures.set(key, t);
    }
    return t;
  }

  // PBR-материал из набора Poly Haven (diff / nor_gl / arm). repeat — масштаб UV.
  pbr(name, { repeat = 1, color = 0xffffff, normalScale = 1, roughness = 1, metalness = 1, side = THREE.FrontSide, envMapIntensity = 1 } = {}) {
    const key = `${name}|${repeat}|${color}|${normalScale}|${roughness}|${metalness}|${side}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const map = this.tex(name, 'diff').clone(); map.needsUpdate = true;
    const nor = this.tex(name, 'nor').clone(); nor.needsUpdate = true;
    const arm = this.tex(name, 'arm').clone(); arm.needsUpdate = true;
    for (const t of [map, nor, arm]) t.repeat.set(repeat, repeat);
    const m = new THREE.MeshStandardMaterial({
      map, normalMap: nor, roughnessMap: arm, metalnessMap: arm, aoMap: arm,
      color, roughness, metalness, side, envMapIntensity,
      normalScale: new THREE.Vector2(normalScale, normalScale),
    });
    m.aoMapIntensity = 0.8;
    this.materials.set(key, m);
    return m;
  }
}

export const assets = new Assets();

// Подготовка модели: тени, единый масштаб, корректные материалы
export function prepModel(root, { cast = true, receive = true } = {}) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast; o.receiveShadow = receive;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.transparent && m.opacity === 1 && m.map) { m.transparent = false; m.alphaTest = 0.5; }
        if (m.map) m.map.anisotropy = 8;
      }
    }
  });
  return root;
}

// Собирает геометрии и материалы модели в список {geometry, material} с запечёнными трансформами —
// для InstancedMesh (много одинаковых объектов одной отрисовкой на материал).
export function flattenModel(root, filter = null) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (filter && !filter(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    parts.push({ geometry: g, material: o.material });
  });
  return parts;
}
