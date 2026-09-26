/**
 * Parametric anatomical models for animals that have no freely licensed
 * ready-made model reachable from this project (jellyfish, manta, moray,
 * anglerfish, lanternfish, snailfish). They are built from anatomical
 * profiles (lathed bodies, lofted wings, tubes) and animated in the vertex
 * shader. They are flagged as procedural in the UI and credits.
 * Convention: head → +X, dorsal → +Y, metres.
 */
import * as THREE from "three";
import { patchObject } from "../water";

export interface ProcInstance { obj: THREE.Object3D; tick: (dt: number, speedFactor: number) => void }

type Uniforms = { uT: { value: number }; uPhase: { value: number } };

/** Add a vertex animation to a standard material before the medium patch. */
function animated(mat: THREE.MeshStandardMaterial, u: Uniforms, displace: string): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = u.uT;
    sh.uniforms.uPhase = u.uPhase;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uT; uniform float uPhase;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + displace);
  };
  return mat;
}

function uni(): Uniforms { return { uT: { value: 0 }, uPhase: { value: Math.random() * 6.28 } }; }

function finish(obj: THREE.Object3D, u: Uniforms, rate: number): ProcInstance {
  patchObject(obj);
  return { obj, tick: (dt, s) => { u.uT.value += dt * rate * s; } };
}

function lathedBody(profile: Array<[number, number]>, mat: THREE.Material, seg = 24) {
  const g = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 1e-4), x)), seg);
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function spotTexture(base: string, spot: string, n: number, rmax: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++) {
    g.fillStyle = spot;
    g.beginPath();
    g.ellipse(Math.random() * 256, Math.random() * 256, 2 + Math.random() * rmax, 2 + Math.random() * rmax, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Moon jelly (Aurelia aurita) or Atolla (Atolla wyvillei). Bell axis +Y; swims upward-forward. */
export function jellyfish(kind: "aurelia" | "atolla", diameter: number): ProcInstance {
  const u = uni();
  const R = diameter / 2;
  const g = new THREE.Group();
  const bellCol = kind === "aurelia" ? 0xd7e9f2 : 0x8a1420;
  const bellMat = animated(
    new THREE.MeshStandardMaterial({ color: bellCol, transparent: true, opacity: kind === "aurelia" ? 0.45 : 0.85, roughness: 0.2, side: THREE.DoubleSide, emissive: kind === "atolla" ? 0x0a3aff : 0x000000, emissiveIntensity: 0 }),
    u,
    // bell contraction: rim pulls in, apex rises
    `float pulse = 0.5 + 0.5 * sin(uT * 2.2 + uPhase);
     float h = clamp(transformed.y / ${R.toFixed(3)}, 0.0, 1.0);
     transformed.xz *= 1.0 - 0.22 * pulse * (1.0 - h);
     transformed.y += 0.08 * ${R.toFixed(3)} * pulse * h;`,
  );
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * (Math.PI / 2);
    prof.push([Math.cos(a) * R * 0.55, Math.sin(a) * R]);
  }
  prof.push([-0.02 * R, R * 0.98]);
  const bell = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 48), bellMat);
  g.add(bell);
  if (kind === "aurelia") {
    // four gonad rings seen through the bell
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.18, R * 0.035, 8, 24), new THREE.MeshStandardMaterial({ color: 0xc58bd6, transparent: true, opacity: 0.8 }));
      const a = (i / 4) * Math.PI * 2 + 0.78;
      ring.position.set(Math.cos(a) * R * 0.28, R * 0.25, Math.sin(a) * R * 0.28);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
  } else {
    // coronal groove and blue bioluminescent rim (the "alarm jellyfish")
    const glow = new THREE.Mesh(new THREE.TorusGeometry(R * 0.98, R * 0.03, 8, 64), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x1a6bff, emissiveIntensity: 3 }));
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 0.02 * R;
    glow.name = "biolum";
    g.add(glow);
  }
  // marginal tentacles and oral arms
  const tentMat = animated(
    new THREE.MeshStandardMaterial({ color: kind === "aurelia" ? 0xe8f4f8 : 0x9b1b2a, transparent: true, opacity: 0.55, roughness: 0.4 }),
    u,
    `float d = -transformed.y;
     transformed.x += sin(d * 3.0 - uT * 2.0 + uPhase + position.z * 4.0) * 0.08 * d;
     transformed.z += cos(d * 2.5 - uT * 1.7 + uPhase) * 0.06 * d;`,
  );
  const nT = kind === "aurelia" ? 64 : 22;
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * Math.PI * 2;
    const L = (kind === "aurelia" ? 0.25 : 1.2) * diameter * (0.8 + Math.random() * 0.4);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.004 * diameter, 0.002 * diameter, L, 4, 12), tentMat);
    t.geometry.translate(0, -L / 2, 0);
    t.position.set(Math.cos(a) * R * 0.97, 0, Math.sin(a) * R * 0.97);
    g.add(t);
  }
  const armN = 4;
  for (let i = 0; i < armN; i++) {
    const L = diameter * (kind === "aurelia" ? 0.45 : 0.3);
    const arm = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.18, L, 2, 16), tentMat);
    arm.geometry.translate(0, -L / 2, 0);
    arm.rotation.y = (i / armN) * Math.PI;
    arm.position.y = 0.05 * R;
    g.add(arm);
  }
  return finish(g, u, 1);
}

/** Reef manta (Mobula birostris-like planform), wing flapping with a travelling wave. */
export function manta(span: number): ProcInstance {
  const u = uni();
  const half = span / 2;
  const L = span * 0.55;
  const nu = 40, nv = 40;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const s = i / nu; // 0 tail end → 1 head
    const w = half * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.15)), 0.8) * (s > 0.85 ? 1 - (s - 0.85) * 2.2 : 1);
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      const x = (s - 0.5) * L - Math.abs(v) * L * 0.22 * (1 - s); // swept wing tips
      const z = v * Math.max(w, 0.02);
      const thick = 0.07 * span * (1 - v * v) * Math.sin(Math.PI * s);
      pos.push(x, thick * 0.5, z);
      uv.push(s, (v + 1) / 2);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = spotTexture("#1c2229", "#2a323b", 60, 10);
  const mat = animated(
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }),
    u,
    `float sp = abs(transformed.z) / ${half.toFixed(3)};
     transformed.y += sin(uT * 1.6 + uPhase - sp * 1.8) * ${(0.22 * span).toFixed(3)} * pow(sp, 1.6);`,
  );
  // white ventral side
  mat.onBeforeCompile = ((prev) => (sh: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
    prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.86, 0.87, 0.85);");
  })(mat.onBeforeCompile);
  const body = new THREE.Mesh(g, mat);
  const grp = new THREE.Group();
  grp.add(body);
  // cephalic lobes and whip tail
  for (const s of [1, -1]) {
    const lobe = new THREE.Mesh(new THREE.CapsuleGeometry(0.02 * span, 0.12 * span, 4, 8), new THREE.MeshStandardMaterial({ color: 0x1c2229, roughness: 0.7 }));
    lobe.rotation.z = Math.PI / 2;
    lobe.position.set(L * 0.52, 0, s * 0.07 * span);
    grp.add(lobe);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.004 * span, 0.012 * span, 0.35 * span, 6), new THREE.MeshStandardMaterial({ color: 0x1c2229 }));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -L * 0.5 - 0.17 * span;
  grp.add(tail);
  return finish(grp, u, 1);
}

/** Giant moray (Gymnothorax javanicus-like): undulating tube body with mottled skin. */
export function moray(length: number): ProcInstance {
  const u = uni();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 30; i++) pts.push(new THREE.Vector3(length / 2 - (i / 30) * length, 0, 0));
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 120, 0.055 * length, 14, false);
  // taper: head bulk, laterally compressed tail
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const s = (length / 2 - x) / length; // 0 head → 1 tail
    const r = s < 0.08 ? 0.55 + s * 5.5 : 1 - 0.75 * Math.pow(s, 1.5);
    p.setY(i, p.getY(i) * r * 1.2);
    p.setZ(i, p.getZ(i) * r * (0.9 - 0.5 * s));
  }
  g.computeVertexNormals();
  const mat = animated(
    new THREE.MeshStandardMaterial({ map: spotTexture("#6b6a2e", "#2a2a14", 380, 6), roughness: 0.45 }),
    u,
    `float s = (${(length / 2).toFixed(3)} - transformed.x) / ${length.toFixed(3)};
     transformed.z += sin(s * 9.0 - uT * 3.0 + uPhase) * ${(0.07 * length).toFixed(3)} * (0.2 + s);`,
  );
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, mat));
  // open jaw and eyes
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012 * length, 10, 8), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1 }));
    eye.position.set(length / 2 - 0.05 * length, 0.03 * length, s * 0.028 * length);
    grp.add(eye);
  }
  return finish(grp, u, 1);
}

/** Humpback anglerfish (Melanocetus): globose body, huge jaw, glowing esca. */
export function anglerfish(length: number): ProcInstance {
  const u = uni();
  const dark = animated(new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.55 }), u,
    `float s = (${(length * 0.5).toFixed(3)} - transformed.x) / ${length.toFixed(3)};
     transformed.z += sin(uT * 4.0 + uPhase - s * 5.0) * ${(0.05 * length).toFixed(3)} * s * s;`);
  const grp = new THREE.Group();
  const body = lathedBody([[-0.5 * length, 0], [-0.45 * length, 0.08 * length], [-0.2 * length, 0.3 * length], [0.1 * length, 0.34 * length], [0.35 * length, 0.25 * length], [0.5 * length, 0.05 * length], [0.5 * length, 0]], dark, 28);
  body.scale.set(1, 1.05, 0.8);
  grp.add(body);
  const jaw = lathedBody([[0, 0], [0.05 * length, 0.2 * length], [0.2 * length, 0.18 * length], [0.25 * length, 0]], new THREE.MeshStandardMaterial({ color: 0x1d1512, roughness: 0.5 }), 20);
  jaw.scale.set(1, 0.4, 0.9);
  jaw.position.set(0.3 * length, -0.15 * length, 0);
  jaw.rotation.z = -0.35;
  grp.add(jaw);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.3, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 13 - 0.5) * 2.2;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.008 * length, 0.07 * length, 5), toothMat);
    tooth.position.set(0.44 * length + Math.cos(a) * 0.03 * length, -0.08 * length, Math.sin(a) * 0.16 * length);
    grp.add(tooth);
  }
  const illicium = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.25 * length, 0.3 * length, 0), new THREE.Vector3(0.45 * length, 0.62 * length, 0), new THREE.Vector3(0.7 * length, 0.42 * length, 0)), 16, 0.006 * length, 6), new THREE.MeshStandardMaterial({ color: 0x2a211b }));
  grp.add(illicium);
  const esca = new THREE.Mesh(new THREE.SphereGeometry(0.035 * length, 12, 10), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x7cf5ff, emissiveIntensity: 4 }));
  esca.position.set(0.7 * length, 0.42 * length, 0);
  esca.name = "biolum";
  grp.add(esca);
  const lure = new THREE.PointLight(0x7cf5ff, 0.4, 2.5 * length, 2);
  lure.position.copy(esca.position);
  grp.add(lure);
  return finish(grp, u, 1);
}

/** Streamlined small fish body (lanternfish, snailfish) with tail undulation. */
function smallFish(length: number, color: number, u: Uniforms, girth = 0.12, tadpole = false) {
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i++) {
    const s = i / 20;
    const r = tadpole ? girth * length * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.6 + 0.02)), 0.7) * (s < 0.6 ? 1 : 0.25 + (1 - s)) : girth * length * Math.pow(Math.sin(Math.PI * s), 0.8);
    prof.push([(s - 0.5) * length, r]);
  }
  const mat = animated(new THREE.MeshStandardMaterial({ color, roughness: tadpole ? 0.25 : 0.35, metalness: tadpole ? 0 : 0.5, transparent: tadpole, opacity: tadpole ? 0.8 : 1 }), u,
    `float s = (${(length / 2).toFixed(4)} - transformed.x) / ${length.toFixed(4)};
     transformed.z += sin(uT * 9.0 + uPhase - s * 6.0) * ${(0.09 * length).toFixed(4)} * s * s;`);
  const body = lathedBody(prof, mat, 16);
  body.scale.set(1, 1, tadpole ? 1 : 0.55);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(girth * length * 0.9, 0.18 * length, 3), mat);
  tail.rotation.z = Math.PI / 2;
  tail.scale.set(1, 1, 0.15);
  tail.position.x = -0.55 * length;
  return [body, tail];
}

/** Lanternfish (Myctophidae) with ventral photophores. */
export function lanternfish(length: number): ProcInstance {
  const u = uni();
  const grp = new THREE.Group();
  grp.add(...smallFish(length, 0x3b4450, u, 0.11));
  const ph = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6ad8ff, emissiveIntensity: 3 });
  for (let i = 0; i < 10; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.012 * length, 6, 4), ph);
    d.position.set((0.35 - i * 0.07) * length, -0.07 * length, (i % 2 ? 1 : -1) * 0.03 * length);
    d.name = "biolum";
    grp.add(d);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04 * length, 10, 8), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.6, roughness: 0.1 }));
  eye.position.set(0.36 * length, 0.02 * length, 0.045 * length);
  grp.add(eye);
  return finish(grp, u, 1);
}

/** Mariana snailfish (Pseudoliparis swirei): translucent, tadpole-shaped hadal fish. */
export function snailfish(length: number): ProcInstance {
  const u = uni();
  const grp = new THREE.Group();
  grp.add(...smallFish(length, 0xf3dfe3, u, 0.16, true));
  return finish(grp, u, 0.6);
}

/** Bend a static glTF fish (no skeleton) with a head-to-tail travelling wave. */
export function addSwimBend(obj: THREE.Object3D, freq: number): (dt: number, speedFactor: number) => void {
  const u = uni();
  obj.updateMatrixWorld(true);
  const pivotInv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const toLocal = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(m.matrixWorld).invert(), obj.matrixWorld);
    void pivotInv;
    const axis = new THREE.Vector3(1, 0, 0).transformDirection(toLocal);
    const lat = new THREE.Vector3(0, 0, 1).transformDirection(toLocal);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const L = Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
    const mat = m.material as THREE.MeshStandardMaterial;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      sh.uniforms.uT = u.uT; sh.uniforms.uPhase = u.uPhase;
      sh.uniforms.uAx = { value: axis }; sh.uniforms.uLat = { value: lat }; sh.uniforms.uC = { value: c }; sh.uniforms.uL = { value: L };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uT; uniform float uPhase; uniform vec3 uAx; uniform vec3 uLat; uniform vec3 uC; uniform float uL;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float s = 0.5 - dot(transformed - uC, uAx) / uL; // 0 head → 1 tail
          transformed += uLat * sin(uT * ${freq.toFixed(2)} + uPhase - s * 5.5) * 0.09 * uL * s * s;`);
      prev?.call(mat, sh, r);
    };
    mat.customProgramCacheKey = () => "swimbend-" + mat.uuid;
    mat.needsUpdate = true;
  });
  return (dt, s) => { u.uT.value += dt * s; };
}
