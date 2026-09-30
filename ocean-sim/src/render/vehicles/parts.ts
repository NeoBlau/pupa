/**
 * Reusable engineered parts for the submersible models. All models use the
 * convention: +X forward, +Y up, metres. Parts are built from lathed profiles,
 * bevelled extrusions and tubes so edges catch light like machined parts.
 */
import * as THREE from "three";

export const MAT = {
  paint: (hex: number, rough = 0.45) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.05 }),
  titanium: () => new THREE.MeshStandardMaterial({ color: 0x8c8f93, roughness: 0.32, metalness: 0.85 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0x5b5f64, roughness: 0.5, metalness: 0.7 }),
  darkSteel: () => new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6, metalness: 0.6 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9, metalness: 0 }),
  carbon: () => new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.35, metalness: 0.4 }),
  acrylic: (tint = 0x9fd8ff) =>
    new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.03, metalness: 0, transmission: 0.92, thickness: 0.12, ior: 1.49, transparent: true, opacity: 0.35 }),
  glow: (hex: number, intensity = 3) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: intensity }),
};

/** Solid of revolution around the X axis from (x, r) points. */
export function lathe(profile: Array<[number, number]>, mat: THREE.Material, seg = 48): THREE.Mesh {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0001), x));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Smooth streamlined profile: nose ogive, parallel body, tapered tail. */
export function hullProfile(length: number, radius: number, nose = 0.25, tail = 0.35, tailR = 0.15, n = 40): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const x0 = -length / 2;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const x = x0 + s * length;
    let r: number;
    if (s < tail) {
      const u = s / tail;
      r = radius * (tailR + (1 - tailR) * Math.sin((u * Math.PI) / 2));
    } else if (s > 1 - nose) {
      const u = (s - (1 - nose)) / nose;
      r = radius * Math.sqrt(Math.max(0, 1 - u * u));
    } else r = radius;
    out.push([x, r]);
  }
  out.push([x0 + length, 0]);
  out.unshift([x0, 0]);
  return out;
}

/** Rounded, bevelled box (panel / fairing block). */
export function roundedBox(w: number, h: number, d: number, r: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + rr, y);
  shape.lineTo(x + w - rr, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + rr);
  shape.lineTo(x + w, y + h - rr);
  shape.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  shape.lineTo(x + rr, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - rr);
  shape.lineTo(x, y + rr);
  shape.quadraticCurveTo(x, y, x + rr, y);
  const bev = Math.min(rr * 0.6, d / 4);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * bev, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, -(d - 2 * bev) / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Ducted thruster (Kort nozzle, 5-blade propeller, stator, motor pod). Axis +X. */
export function thruster(diam: number): THREE.Group {
  const g = new THREE.Group();
  const r = diam / 2;
  const L = diam * 0.55;
  const duct = lathe([[-L / 2, r * 1.02], [-L / 2 + L * 0.1, r * 1.15], [L * 0.2, r * 1.12], [L / 2, r * 1.03], [L / 2, r * 0.98], [-L / 2, r * 0.98]], MAT.darkSteel(), 40);
  (duct.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(duct);
  const hub = lathe([[-L * 0.8, 0], [-L * 0.8, r * 0.22], [-L * 0.2, r * 0.3], [L * 0.3, r * 0.28], [L * 0.55, r * 0.12], [L * 0.6, 0]], MAT.steel(), 24);
  g.add(hub);
  const prop = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02 * diam, r * 0.72, r * 0.3), MAT.titanium());
    blade.position.y = r * 0.55;
    const arm = new THREE.Group();
    arm.add(blade);
    blade.rotation.y = 0.5;
    arm.rotation.x = (i / 5) * Math.PI * 2;
    prop.add(arm);
  }
  prop.name = "prop";
  g.add(prop);
  for (let i = 0; i < 3; i++) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(L * 0.3, r * 0.85, 0.015 * diam), MAT.darkSteel());
    strut.position.set(-L * 0.3, 0, 0);
    const a = new THREE.Group();
    strut.position.y = r * 0.55;
    a.add(strut);
    a.rotation.x = (i / 3) * Math.PI * 2 + 0.3;
    g.add(a);
  }
  g.userData.kind = "thruster";
  return g;
}

/** LED floodlight with a visible volumetric beam cone (additive). Aims along +X. */
export function floodLight(size: number, beamLength = 12, beamAngle = 0.35): THREE.Group {
  const g = new THREE.Group();
  const body = lathe([[-size, 0], [-size, size * 0.45], [-size * 0.2, size * 0.5], [0, size * 0.52], [0.02 * size, size * 0.5], [0.02 * size, 0]], MAT.darkSteel(), 24);
  g.add(body);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(size * 0.46, 24), MAT.glow(0xfff4e0, 4));
  lens.rotation.y = Math.PI / 2;
  lens.position.x = 0.025 * size;
  lens.name = "lens";
  g.add(lens);
  for (let i = 0; i < 6; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(size * 0.6, 0.012, size * 0.2), MAT.darkSteel());
    fin.position.set(-size * 0.6, 0, 0);
    const a = new THREE.Group();
    fin.position.y = size * 0.5;
    a.add(fin);
    a.rotation.x = (i / 6) * Math.PI * 2;
    g.add(a);
  }
  const coneG = new THREE.ConeGeometry(Math.tan(beamAngle) * beamLength, beamLength, 32, 1, true);
  coneG.rotateZ(Math.PI / 2);
  coneG.translate(beamLength / 2 + 0.05, 0, 0);
  const cone = new THREE.Mesh(
    coneG,
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 0.96, 0.88) }, uLen: { value: beamLength }, uOn: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: "varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 uColor; uniform float uLen; uniform float uOn; varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ float along = clamp(vP.x/uLen,0.0,1.0); float edge = pow(abs(dot(vN,vV)),1.5); gl_FragColor = vec4(uColor*0.09*(1.0-along)*(1.0-along)*edge*uOn,1.0); }",
    }),
  );
  cone.name = "beam";
  g.add(cone);
  const spot = new THREE.SpotLight(0xfff2e0, 0, beamLength * 3.5, beamAngle * 1.25, 0.45, 1.3);
  spot.position.set(0.05, 0, 0);
  spot.target.position.set(5, 0, 0);
  spot.name = "spot";
  g.add(spot, spot.target);
  g.userData.kind = "light";
  return g;
}

/** Camera pod: housing + dome port. Looks along +X. */
export function cameraPod(size: number): THREE.Group {
  const g = new THREE.Group();
  g.add(lathe([[-size * 1.2, 0], [-size * 1.2, size * 0.4], [0, size * 0.42], [0, 0]], MAT.darkSteel(), 20));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(size * 0.38, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.acrylic(0x223344));
  dome.rotation.z = -Math.PI / 2;
  g.add(dome);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(size * 0.18, 16, 12), new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.1, metalness: 0.2 }));
  eye.position.x = size * 0.05;
  g.add(eye);
  g.userData.kind = "camera";
  return g;
}

/** Hydraulic/electric manipulator: shoulder, upper arm, forearm, wrist, 3-finger claw. */
export function manipulator(len: number, mat: THREE.Material = MAT.titanium()): THREE.Group {
  const root = new THREE.Group();
  const joint = (r: number) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 1.6, 18), MAT.darkSteel());
  const link = (l: number, r: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, l, 16), mat);
    m.rotation.z = -Math.PI / 2;
    m.position.x = l / 2;
    return m;
  };
  const shoulder = new THREE.Group();
  const sj = joint(len * 0.07); sj.rotation.x = Math.PI / 2;
  shoulder.add(sj, link(len * 0.45, len * 0.05));
  const elbow = new THREE.Group();
  elbow.position.x = len * 0.45;
  const ej = joint(len * 0.055); ej.rotation.x = Math.PI / 2;
  elbow.add(ej, link(len * 0.4, len * 0.04));
  const wrist = new THREE.Group();
  wrist.position.x = len * 0.4;
  const wj = joint(len * 0.045);
  wj.rotation.z = Math.PI / 2;
  wrist.add(wj);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Group();
    const seg1 = new THREE.Mesh(new THREE.BoxGeometry(len * 0.12, len * 0.02, len * 0.025), MAT.steel());
    seg1.position.x = len * 0.06;
    const seg2 = new THREE.Mesh(new THREE.BoxGeometry(len * 0.08, len * 0.018, len * 0.022), MAT.steel());
    seg2.position.set(len * 0.15, -len * 0.015, 0);
    seg2.rotation.z = -0.5;
    f.add(seg1, seg2);
    f.rotation.x = (i / 3) * Math.PI * 2;
    f.rotation.z = 0.35;
    wrist.add(f);
  }
  elbow.add(wrist);
  shoulder.add(elbow);
  root.add(shoulder);
  root.userData = { kind: "arm", shoulder, elbow, wrist };
  // stowed pose
  shoulder.rotation.z = -0.9;
  elbow.rotation.z = 1.9;
  wrist.rotation.z = -0.8;
  return root;
}

/** Whip antenna with base. */
export function antenna(h: number): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.08, 12), MAT.darkSteel());
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, h, 6), MAT.rubber());
  whip.position.y = h / 2 + 0.04;
  g.add(base, whip);
  return g;
}

/** Xenon/LED strobe for surface recovery (flashes when surfaced). */
export function strobe(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 12), MAT.darkSteel()));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), MAT.glow(0xffffff, 0));
  lamp.position.y = 0.05;
  lamp.name = "strobe";
  g.add(lamp);
  return g;
}

/** Louvred cooling grille panel. */
export function grille(w: number, h: number, slats = 8): THREE.Group {
  const g = new THREE.Group();
  const frame = roundedBox(w, h, 0.04, 0.03, MAT.darkSteel());
  g.add(frame);
  for (let i = 0; i < slats; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, (h / slats) * 0.45, 0.02), MAT.carbon());
    s.position.set(0, -h / 2 + (h / slats) * (i + 0.5), 0.025);
    s.rotation.x = -0.5;
    g.add(s);
  }
  return g;
}

/** Text plate (hull name, markings). */
export function label(text: string, w: number, h: number, color = "#111", bg: string | null = null): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 512; c.height = Math.round((512 * h) / w);
  const g = c.getContext("2d")!;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  g.fillStyle = color;
  g.font = `700 ${Math.round(c.height * 0.72)}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: !bg, roughness: 0.6 }));
  return m;
}

/** Viewport: acrylic frustum window in a titanium retaining ring, looking along +X. */
export function viewport(r: number): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.08, r * 0.14, 12, 36), MAT.titanium());
  ring.rotation.y = Math.PI / 2;
  const glass = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, 0.5), MAT.acrylic());
  glass.rotation.z = -Math.PI / 2;
  glass.position.x = -r * 0.85;
  g.add(ring, glass);
  for (let i = 0; i < 12; i++) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.04, r * 0.04, r * 0.06, 6), MAT.steel());
    const a = (i / 12) * Math.PI * 2;
    bolt.position.set(0.01, Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08);
    bolt.rotation.z = Math.PI / 2;
    g.add(bolt);
  }
  return g;
}

/** Drop-weight / ballast block with release latch. */
export function weightBlock(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const b = roundedBox(w, h, d, 0.03, MAT.paint(0x3a3d40, 0.8));
  const latch = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 0.3, d * 1.05), MAT.paint(0xd84b20, 0.5));
  latch.position.y = h * 0.4;
  g.add(b, latch);
  g.userData.kind = "weight";
  return g;
}

/** Aim `obj` (built along +X) along `dir`. */
export function aim(obj: THREE.Object3D, dir: THREE.Vector3) {
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
  return obj;
}
