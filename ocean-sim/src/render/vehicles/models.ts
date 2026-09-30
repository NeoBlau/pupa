/**
 * 3D models of the five submersibles. The four historical craft follow their
 * real layout (float/sphere/sail/pontoons, viewport count, thruster
 * arrangement); Nereid-X is an original design.
 * Convention: +X forward, +Y up, origin at the centre of buoyancy, metres.
 */
import * as THREE from "three";
import { aim, antenna, cameraPod, floodLight, grille, hullProfile, label, lathe, manipulator, MAT, roundedBox, strobe, thruster, viewport, weightBlock } from "./parts";

export interface ThrusterRef { obj: THREE.Object3D; role: "surge" | "heave" | "sway" | "yaw" }

export interface VehicleModel {
  root: THREE.Group;
  lights: THREE.Group[];
  thrusters: ThrusterRef[];
  /** Pressure sphere (local): centre, inner radius, viewport directions (unit) and half-angles. */
  cabin: { center: THREE.Vector3; radius: number; viewports: Array<{ dir: THREE.Vector3; half: number }>; eye: THREE.Vector3; look: THREE.Vector3; seats: number };
  arms: THREE.Group[];
  strobes: THREE.Object3D[];
  descentWeights: THREE.Object3D[];
  ascentWeights: THREE.Object3D[];
  /** External camera mounts for cockpit feeds: position and look direction (local). */
  cams: Array<{ name: string; pos: THREE.Vector3; dir: THREE.Vector3 }>;
  /** Bubble sources: thruster outlets and tank vents (local). */
  vents: THREE.Vector3[];
  /** Third-person camera distance. */
  viewDistance: number;
}

function base(): Omit<VehicleModel, "cabin" | "viewDistance"> {
  return { root: new THREE.Group(), lights: [], thrusters: [], arms: [], strobes: [], descentWeights: [], ascentWeights: [], cams: [], vents: [] };
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function addLight(m: ReturnType<typeof base>, pos: THREE.Vector3, dir: THREE.Vector3, size = 0.12, len = 14) {
  const l = floodLight(size, len);
  l.position.copy(pos);
  aim(l, dir);
  m.root.add(l);
  m.lights.push(l);
  return l;
}

function addThruster(m: ReturnType<typeof base>, pos: THREE.Vector3, axis: THREE.Vector3, diam: number, role: ThrusterRef["role"]) {
  const t = thruster(diam);
  t.position.copy(pos);
  aim(t, axis);
  m.root.add(t);
  m.thrusters.push({ obj: t, role });
  m.vents.push(pos.clone());
  return t;
}

function addCam(m: ReturnType<typeof base>, name: string, pos: THREE.Vector3, dir: THREE.Vector3, size = 0.08) {
  const c = cameraPod(size);
  c.position.copy(pos);
  aim(c, dir);
  m.root.add(c);
  m.cams.push({ name, pos: pos.clone(), dir: dir.clone().normalize() });
}

function side(text: string, m: ReturnType<typeof base>, x: number, y: number, z: number, w: number, h: number, color: string) {
  for (const s of [1, -1]) {
    const l = label(text, w, h, color);
    l.position.set(x, y, s * z);
    l.rotation.y = s > 0 ? 0 : Math.PI;
    m.root.add(l);
  }
}

// ───────────────────────────── Trieste (1960) ─────────────────────────────
export function buildTrieste(): VehicleModel {
  const m = base();
  const floatMat = MAT.paint(0xd6d8d2, 0.55);
  const float = lathe(hullProfile(18.1, 1.75, 0.18, 0.22, 0.25, 60), floatMat, 56);
  float.position.y = 1.5;
  m.root.add(float);
  // deck, rails and conning tower
  const deck = roundedBox(14, 0.08, 0.9, 0.03, MAT.paint(0x8a7d6a, 0.9));
  deck.position.set(0, 3.27, 0);
  m.root.add(deck);
  for (let i = -6; i <= 6; i++) {
    for (const s of [1, -1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), MAT.steel());
      post.position.set(i, 3.65, s * 0.43);
      m.root.add(post);
    }
  }
  for (const s of [1, -1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 12, 6), MAT.steel());
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 4.0, s * 0.43);
    m.root.add(rail);
  }
  const tower = roundedBox(2.3, 1.2, 1.1, 0.25, MAT.paint(0xcfd2cc, 0.55));
  tower.position.set(0.6, 3.9, 0);
  m.root.add(tower);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.2, 24), MAT.steel());
  hatch.position.set(0.9, 4.55, 0);
  m.root.add(hatch);
  // access trunk to the sphere
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 3.2, 20), MAT.paint(0xbfc2bc));
  trunk.position.set(0.5, 0.3, 0);
  m.root.add(trunk);
  // Krupp pressure sphere, 2.16 m inside, 127 mm wall
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.21, 48, 32), MAT.paint(0x3a3f45, 0.6));
  sphere.position.set(0.5, -1.25, 0);
  m.root.add(sphere);
  for (let i = 0; i < 2; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.215, 0.035, 10, 64), MAT.darkSteel());
    band.position.copy(sphere.position);
    band.rotation.y = i * Math.PI / 2;
    m.root.add(band);
  }
  const vpDir = v3(0.92, -0.39, 0).normalize();
  const vp = viewport(0.1);
  vp.position.copy(sphere.position).addScaledVector(vpDir, 1.2);
  aim(vp, vpDir);
  m.root.add(vp);
  // iron-shot hoppers fore and aft of the sphere
  for (const x of [-3.2, 3.6]) {
    const hopper = lathe([[0, 0], [0, 0.55], [1.3, 0.7], [1.9, 0.72], [1.9, 0]], MAT.paint(0x2c2f33, 0.7), 28);
    hopper.rotation.z = Math.PI / 2;
    hopper.position.set(x, -1.6, 0);
    m.root.add(hopper);
    const latch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16), MAT.paint(0xc8102e, 0.5));
    latch.position.set(x, -1.68, 0);
    m.root.add(latch);
    const shot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.9, 20), MAT.paint(0x1b1c1e, 0.9));
    shot.position.set(x, -0.9, 0);
    m.root.add(shot);
    (x < 0 ? m.ascentWeights : m.descentWeights).push(shot);
  }
  // guide rope
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 6), MAT.rubber());
  rope.position.set(6.2, -1.6, 0);
  m.root.add(rope);
  // stern propellers
  for (const s of [1, -1]) addThruster(m, v3(-7.3, 3.4, s * 0.8), v3(1, 0, 0), 0.5, "surge");
  addThruster(m, v3(-8.2, 1.5, 0), v3(0, 0, 1), 0.4, "yaw");
  addLight(m, v3(6.2, -0.1, 0.9), v3(1, -0.35, 0.1), 0.14, 16);
  addLight(m, v3(6.2, -0.1, -0.9), v3(1, -0.35, -0.1), 0.14, 16);
  addLight(m, v3(1.5, -1.9, 0), v3(0.5, -1, 0), 0.12, 12);
  side("TRIESTE", m, 1.0, 2.1, 1.77, 5.2, 0.7, "#1a2a44");
  side("U.S. NAVY", m, 1.0, 1.45, 1.77, 2.2, 0.28, "#1a2a44");
  const s1 = strobe(); s1.position.set(0.9, 4.65, 0.3); m.root.add(s1); m.strobes.push(s1);
  const ant = antenna(1.6); ant.position.set(0.1, 4.5, -0.35); m.root.add(ant);
  addCam(m, "keel", v3(0.5, -2.45, 0), v3(0.2, -1, 0), 0.07);
  m.vents.push(v3(-6, 3.3, 0), v3(6, 3.3, 0));
  return {
    ...m,
    cabin: { center: v3(0.5, -1.25, 0), radius: 1.08, viewports: [{ dir: vpDir, half: 0.14 }], eye: v3(0.72, -1.22, 0.1), look: vpDir, seats: 2 },
    viewDistance: 17,
  };
}

// ───────────────────────────── Alvin (2022) ─────────────────────────────
export function buildAlvin(): VehicleModel {
  const m = base();
  const white = MAT.paint(0xf0efe9, 0.5);
  const body = roundedBox(5.8, 2.1, 2.4, 0.55, white);
  body.position.set(-0.5, 0.35, 0);
  m.root.add(body);
  // fairing seams and access panels
  for (const x of [-2.6, -1.2, 0.2]) {
    for (const s of [1, -1]) {
      const p = roundedBox(1.1, 0.9, 0.03, 0.08, MAT.paint(0xe6e5de, 0.55));
      p.position.set(x, 0.55, s * 1.2);
      m.root.add(p);
    }
  }
  const sail = roundedBox(2.1, 1.05, 0.62, 0.28, MAT.paint(0xc8102e, 0.45));
  sail.position.set(-0.2, 1.9, 0);
  m.root.add(sail);
  side("ALVIN", m, -0.2, 2.02, 0.32, 1.4, 0.34, "#ffffff");
  side("DSV-2", m, -2.4, 0.55, 1.23, 1.2, 0.3, "#1c2733");
  // titanium personnel sphere, 2.1 m inside
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.12, 48, 32), MAT.titanium());
  sphere.position.set(1.85, -0.25, 0);
  m.root.add(sphere);
  const vps = [v3(1, -0.1, 0), v3(0.82, -0.35, 0.45), v3(0.82, -0.35, -0.45), v3(0.6, -0.78, 0.2), v3(0.6, -0.78, -0.2)].map((d) => d.normalize());
  for (const d of vps) {
    const vp = viewport(0.1);
    vp.position.copy(sphere.position).addScaledVector(d, 1.11);
    aim(vp, d);
    m.root.add(vp);
  }
  // hatch on top of sphere
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.25, 24), MAT.titanium());
  hatch.position.set(1.7, 0.9, 0);
  m.root.add(hatch);
  // sample basket and frame
  const frame = new THREE.Group();
  const bar = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, d.length(), 8), MAT.paint(0xdedcd4, 0.5));
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(v3(0, 1, 0), d.normalize());
    frame.add(c);
  };
  const corners = [v3(2.7, -1.3, 0.9), v3(2.7, -1.3, -0.9), v3(3.5, -1.3, 0.9), v3(3.5, -1.3, -0.9)];
  bar(corners[0], corners[1]); bar(corners[2], corners[3]); bar(corners[0], corners[2]); bar(corners[1], corners[3]);
  for (const c of corners) bar(c, c.clone().setY(-0.95));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.8, 8, 16), new THREE.MeshStandardMaterial({ color: 0x777777, wireframe: true }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(3.1, -1.28, 0);
  frame.add(mesh);
  m.root.add(frame);
  for (const s of [1, -1]) {
    const arm = manipulator(1.6);
    arm.position.set(2.6, -0.7, s * 0.95);
    m.root.add(arm);
    m.arms.push(arm);
  }
  // thrusters: 3 aft, 2 vertical, 2 lateral
  addThruster(m, v3(-3.55, 0.4, 0), v3(1, 0, 0), 0.6, "surge");
  for (const s of [1, -1]) addThruster(m, v3(-3.3, 0.4, s * 1.1), v3(1, 0, 0), 0.5, "yaw");
  for (const s of [1, -1]) addThruster(m, v3(-0.6, 0.9, s * 1.45), v3(0, 1, 0), 0.45, "heave");
  for (const s of [1, -1]) addThruster(m, v3(0.8, 0.2, s * 1.45), v3(0, 0, s), 0.35, "sway");
  // lights & cameras on the forward frame
  addLight(m, v3(2.6, 0.9, 0.85), v3(1, -0.4, 0.15));
  addLight(m, v3(2.6, 0.9, -0.85), v3(1, -0.4, -0.15));
  addLight(m, v3(3.4, -0.8, 0.8), v3(1, -0.6, 0.1));
  addLight(m, v3(3.4, -0.8, -0.8), v3(1, -0.6, -0.1));
  addCam(m, "bow", v3(2.7, 1.0, 0), v3(1, -0.3, 0));
  addCam(m, "starboard", v3(1.2, 0.2, -1.3), v3(0.3, -0.4, -1));
  addCam(m, "basket", v3(2.4, 0.4, 0.5), v3(0.6, -1, 0));
  // skids, weights, sail kit
  for (const s of [1, -1]) {
    const skid = roundedBox(5.4, 0.12, 0.14, 0.05, MAT.darkSteel());
    skid.position.set(-0.3, -1.3, s * 0.95);
    m.root.add(skid);
    const dw = weightBlock(0.7, 0.3, 0.2); dw.position.set(-1.2, -0.9, s * 1.25); m.root.add(dw); m.descentWeights.push(dw);
    const aw = weightBlock(0.7, 0.3, 0.2); aw.position.set(-2.2, -0.9, s * 1.25); m.root.add(aw); m.ascentWeights.push(aw);
  }
  const st = strobe(); st.position.set(-0.8, 2.47, 0); m.root.add(st); m.strobes.push(st);
  const a1 = antenna(1.1); a1.position.set(0.4, 2.45, 0.15); m.root.add(a1);
  const a2 = antenna(0.8); a2.position.set(0.6, 2.45, -0.15); m.root.add(a2);
  const g = grille(0.8, 0.5); g.position.set(-3.1, 1.1, 0); g.rotation.y = -Math.PI / 2; m.root.add(g);
  return {
    ...m,
    cabin: { center: v3(1.85, -0.25, 0), radius: 1.02, viewports: vps.map((d, i) => ({ dir: d, half: i === 0 ? 0.13 : 0.1 })), eye: v3(2.3, -0.28, 0), look: vps[0], seats: 3 },
    viewDistance: 12,
  };
}

// ───────────────────────── Limiting Factor (Triton 36000/2) ─────────────────────────
export function buildLimitingFactor(): VehicleModel {
  const m = base();
  const foam = MAT.paint(0xf3f3f0, 0.55);
  for (const s of [1, -1]) {
    const pont = roundedBox(4.2, 2.6, 0.62, 0.3, foam);
    pont.position.set(0, 0.75, s * 0.63);
    m.root.add(pont);
    const trim = roundedBox(4.25, 0.18, 0.64, 0.06, MAT.paint(0x2b3036, 0.5));
    trim.position.set(0, -0.5, s * 0.63);
    m.root.add(trim);
    side(s > 0 ? "LIMITING FACTOR" : "LIMITING FACTOR", m, 0, 1.3, 0.95, 3.0, 0.3, "#20262c");
  }
  // titanium sphere, 1.5 m inside, 90 mm wall
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 32), MAT.titanium());
  sphere.position.set(0.55, -0.8, 0);
  m.root.add(sphere);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.855, 0.03, 10, 64), MAT.darkSteel());
  ring.position.copy(sphere.position); ring.rotation.y = Math.PI / 2;
  m.root.add(ring);
  const vps = [v3(1, -0.15, 0), v3(0.75, -0.35, 0.55), v3(0.75, -0.35, -0.55)].map((d) => d.normalize());
  for (const d of vps) {
    const vp = viewport(0.085);
    vp.position.copy(sphere.position).addScaledVector(d, 0.85);
    aim(vp, d);
    m.root.add(vp);
  }
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.2, 24), MAT.titanium());
  hatch.position.set(0.4, 0.08, 0);
  m.root.add(hatch);
  // lower frame and skids
  for (const s of [1, -1]) {
    const skid = roundedBox(4.4, 0.12, 0.12, 0.05, MAT.darkSteel());
    skid.position.set(0, -1.75, s * 0.75);
    m.root.add(skid);
    for (const x of [-1.6, 0, 1.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), MAT.darkSteel());
      leg.position.set(x, -1.15, s * 0.75);
      m.root.add(leg);
    }
    const dw = weightBlock(0.6, 0.25, 0.25); dw.position.set(-1.2, -1.5, s * 0.55); m.root.add(dw); m.descentWeights.push(dw);
    const aw = weightBlock(0.6, 0.25, 0.25); aw.position.set(1.4, -1.5, s * 0.55); m.root.add(aw); m.ascentWeights.push(aw);
  }
  // 10 thrusters: 4 vertical, 4 aft/forward horizontal, 2 lateral
  for (const x of [-1.5, 1.5]) for (const s of [1, -1]) addThruster(m, v3(x, 2.15, s * 0.63), v3(0, 1, 0), 0.34, "heave");
  for (const s of [1, -1]) addThruster(m, v3(-2.3, 0.2, s * 0.63), v3(1, 0, 0), 0.38, "surge");
  for (const s of [1, -1]) addThruster(m, v3(-2.3, 1.4, s * 0.63), v3(1, 0, 0), 0.34, "yaw");
  for (const s of [1, -1]) addThruster(m, v3(0, -1.25, s * 0.95), v3(0, 0, s), 0.3, "sway");
  addLight(m, v3(2.15, 1.7, 0.5), v3(1, -0.35, 0.1), 0.12, 13);
  addLight(m, v3(2.15, 1.7, -0.5), v3(1, -0.35, -0.1), 0.12, 13);
  addLight(m, v3(2.15, -0.2, 0.6), v3(1, -0.5, 0.1), 0.1, 12);
  addLight(m, v3(2.15, -0.2, -0.6), v3(1, -0.5, -0.1), 0.1, 12);
  addCam(m, "bow", v3(2.15, 1.2, 0), v3(1, -0.4, 0));
  addCam(m, "down", v3(1.5, -1.6, 0), v3(0.2, -1, 0));
  const arm = manipulator(1.3); arm.position.set(1.7, -1.3, -0.3); m.root.add(arm); m.arms.push(arm);
  const st = strobe(); st.position.set(-1.8, 2.05, 0); m.root.add(st); m.strobes.push(st);
  const ant = antenna(1.0); ant.position.set(-1.2, 2.05, 0); m.root.add(ant);
  return {
    ...m,
    cabin: { center: v3(0.55, -0.8, 0), radius: 0.75, viewports: vps.map((d) => ({ dir: d, half: 0.12 })), eye: v3(0.85, -0.78, 0), look: vps[0], seats: 2 },
    viewDistance: 10,
  };
}

// ───────────────────────────── Mir (1987) ─────────────────────────────
export function buildMir(): VehicleModel {
  const m = base();
  const top = MAT.paint(0xf1efe6, 0.5);
  const orange = MAT.paint(0xe8791a, 0.5);
  const hull = lathe(hullProfile(6.6, 1.25, 0.2, 0.3, 0.3, 50), top, 48);
  hull.scale.set(1, 1.0, 1.1);
  hull.position.set(-0.6, 0.45, 0);
  m.root.add(hull);
  const keel = roundedBox(6.2, 0.7, 2.1, 0.25, orange);
  keel.position.set(-0.4, -0.9, 0);
  m.root.add(keel);
  side("МИР-1", m, -1.2, 0.9, 1.38, 1.8, 0.45, "#c8102e");
  // forged steel sphere, 2.1 m inside, main viewport forward + two side ports
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32), MAT.paint(0xdad6cc, 0.45));
  sphere.position.set(2.1, -0.15, 0);
  m.root.add(sphere);
  const vps = [v3(1, -0.15, 0), v3(0.7, -0.4, 0.6), v3(0.7, -0.4, -0.6)].map((d) => d.normalize());
  vps.forEach((d, i) => {
    const vp = viewport(i === 0 ? 0.13 : 0.08);
    vp.position.copy(sphere.position).addScaledVector(d, 1.1);
    aim(vp, d);
    m.root.add(vp);
  });
  const conn = roundedBox(1.4, 0.7, 0.9, 0.2, top);
  conn.position.set(0.2, 1.8, 0);
  m.root.add(conn);
  // side propulsion pods (swivelling), aft main, vertical
  for (const s of [1, -1]) {
    const pod = lathe(hullProfile(1.4, 0.26), MAT.paint(0xe8791a, 0.5), 24);
    pod.position.set(-2.8, 0.2, s * 1.65);
    m.root.add(pod);
    const pylon = roundedBox(0.8, 0.12, 0.5, 0.05, orange);
    pylon.position.set(-2.8, 0.2, s * 1.35);
    m.root.add(pylon);
    addThruster(m, v3(-3.6, 0.2, s * 1.65), v3(1, 0, 0), 0.55, "yaw");
    addThruster(m, v3(-0.4, 1.3, s * 1.1), v3(0, 1, 0), 0.42, "heave");
  }
  addThruster(m, v3(-4.0, 0.45, 0), v3(1, 0, 0), 0.7, "surge");
  addThruster(m, v3(1.0, -0.6, 1.2), v3(0, 0, 1), 0.32, "sway");
  for (const s of [1, -1]) {
    const arm = manipulator(1.8, MAT.steel());
    arm.position.set(2.7, -0.9, s * 0.8);
    m.root.add(arm);
    m.arms.push(arm);
    const dw = weightBlock(0.9, 0.25, 0.3); dw.position.set(-0.6, -1.35, s * 0.7); m.root.add(dw); m.descentWeights.push(dw);
    const aw = weightBlock(0.9, 0.25, 0.3); aw.position.set(-2.0, -1.35, s * 0.7); m.root.add(aw); m.ascentWeights.push(aw);
  }
  for (const [y, z] of [[0.9, 0.95], [0.9, -0.95], [-0.7, 1.05], [-0.7, -1.05], [1.4, 0.4], [1.4, -0.4]]) addLight(m, v3(2.6, y, z), v3(1, -0.4, z * 0.1), 0.13, 14);
  addCam(m, "bow", v3(2.9, 0.6, 0), v3(1, -0.3, 0));
  addCam(m, "port", v3(1.5, 0.2, 1.35), v3(0.3, -0.4, 1));
  const st = strobe(); st.position.set(0.1, 2.2, 0.2); m.root.add(st); m.strobes.push(st);
  const ant = antenna(1.2); ant.position.set(0.4, 2.15, -0.2); m.root.add(ant);
  return {
    ...m,
    cabin: { center: v3(2.1, -0.15, 0), radius: 1.0, viewports: vps.map((d, i) => ({ dir: d, half: i === 0 ? 0.16 : 0.09 })), eye: v3(2.55, -0.2, 0), look: vps[0], seats: 3 },
    viewDistance: 13,
  };
}

// ───────────────────────────── Nereid-X (concept) ─────────────────────────────
export function buildNereid(): VehicleModel {
  const m = base();
  const graphite = new THREE.MeshPhysicalMaterial({ color: 0x1d232a, roughness: 0.28, metalness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const accent = MAT.glow(0x2ee6ff, 2.5);
  const belly = MAT.titanium();
  // main body: flattened streamlined lifting hull
  const body = lathe(hullProfile(6.2, 1.05, 0.12, 0.42, 0.18, 70), graphite, 64);
  body.scale.set(1, 0.92, 1.3);
  body.position.set(-0.2, 0, 0);
  m.root.add(body);
  const keel = lathe(hullProfile(5.2, 0.55, 0.2, 0.3, 0.2), belly, 40);
  keel.scale.set(1, 0.6, 1.9);
  keel.position.set(-0.4, -0.72, 0);
  m.root.add(keel);
  // accent light strips along the flanks
  for (const s of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([v3(2.2, 0.15, s * 1.12), v3(0.8, 0.28, s * 1.36), v3(-1.0, 0.26, s * 1.36), v3(-2.6, 0.12, s * 1.05), v3(-3.2, 0.05, s * 0.55)]);
    const strip = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.018, 8, false), accent);
    m.root.add(strip);
  }
  // panoramic acrylic dome on a titanium–ceramic sphere
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.02, 56, 36, -Math.PI / 2, Math.PI, 0, Math.PI), MAT.titanium());
  sphere.position.set(1.95, 0.05, 0);
  m.root.add(sphere);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.05, 64, 40, Math.PI / 2, Math.PI, 0, Math.PI), MAT.acrylic(0xbfe8ff));
  dome.position.copy(sphere.position);
  m.root.add(dome);
  const domeRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 16, 80), MAT.titanium());
  domeRing.position.copy(sphere.position);
  domeRing.rotation.y = Math.PI / 2;
  m.root.add(domeRing);
  // wing pods with vectored thrusters
  for (const s of [1, -1]) {
    const wing = roundedBox(2.6, 0.22, 0.9, 0.1, graphite);
    wing.position.set(-0.6, -0.05, s * 1.25);
    m.root.add(wing);
    const pod = lathe(hullProfile(3.0, 0.3, 0.2, 0.35, 0.4, 30), graphite, 28);
    pod.position.set(-0.7, -0.05, s * 1.62);
    m.root.add(pod);
    addThruster(m, v3(-2.25, -0.05, s * 1.62), v3(1, 0, 0), 0.5, "yaw");
    for (const x of [0.4, -1.4]) addThruster(m, v3(x, 0.0, s * 1.62), v3(0, 1, 0), 0.42, "heave");
    const bar = roundedBox(0.08, 0.1, 0.5, 0.03, MAT.darkSteel());
    bar.position.set(0.9, -0.05, s * 1.62);
    m.root.add(bar);
    for (let i = 0; i < 3; i++) addLight(m, v3(0.95, -0.05, s * (1.45 + i * 0.16)), v3(1, -0.25, s * 0.08), 0.06, 16);
    const bay = grille(1.0, 0.45, 9); bay.position.set(-1.3, 0.25, s * 1.3); bay.rotation.y = s > 0 ? 0 : Math.PI; m.root.add(bay);
    const bat = roundedBox(1.6, 0.4, 0.04, 0.05, MAT.carbon());
    bat.position.set(0.2, 0.32, s * 1.33);
    bat.rotation.y = s > 0 ? 0 : Math.PI;
    m.root.add(bat);
    const cells = label("Li-SS 125 kWh", 1.2, 0.14, "#2ee6ff");
    cells.position.set(0.2, 0.32, s * 1.36);
    cells.rotation.y = s > 0 ? 0 : Math.PI;
    m.root.add(cells);
    const dw = weightBlock(0.5, 0.2, 0.3); dw.position.set(0.2, -0.95, s * 0.6); m.root.add(dw); m.descentWeights.push(dw);
    const aw = weightBlock(0.5, 0.2, 0.3); aw.position.set(-1.3, -0.95, s * 0.6); m.root.add(aw); m.ascentWeights.push(aw);
  }
  // twin aft main thrusters with vectoring collars
  for (const s of [1, -1]) addThruster(m, v3(-3.2, 0.05, s * 0.42), v3(1, 0, 0), 0.55, "surge");
  addThruster(m, v3(1.0, -0.55, 0), v3(0, 0, 1), 0.34, "sway");
  // dorsal mast: radome, lidar, GNSS/VHF antennas, strobe, acoustic modem
  const mast = roundedBox(1.3, 0.5, 0.3, 0.12, graphite);
  mast.position.set(-0.6, 1.1, 0);
  m.root.add(mast);
  const radome = lathe([[-0.2, 0], [-0.2, 0.2], [0.05, 0.22], [0.2, 0.14], [0.26, 0]], MAT.paint(0xe9edf0, 0.3), 32);
  radome.rotation.z = Math.PI / 2;
  radome.position.set(-0.6, 1.42, 0);
  m.root.add(radome);
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 24), MAT.carbon());
  lidar.position.set(-0.05, 1.42, 0);
  m.root.add(lidar);
  const lidarBand = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.03, 24), MAT.glow(0x2ee6ff, 2));
  lidarBand.position.set(-0.05, 1.43, 0);
  m.root.add(lidarBand);
  const a1 = antenna(1.0); a1.position.set(-1.05, 1.35, 0.1); m.root.add(a1);
  const a2 = antenna(0.6); a2.position.set(-1.15, 1.35, -0.1); m.root.add(a2);
  const st = strobe(); st.position.set(-0.3, 1.36, 0.1); m.root.add(st); m.strobes.push(st);
  const modem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.18, 16), MAT.paint(0xf2a900, 0.4));
  modem.position.set(-2.4, 0.7, 0);
  m.root.add(modem);
  // chin: sonar dome, multibeam bar, folded manipulator
  const sonar = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), MAT.paint(0xdfe4e8, 0.25));
  sonar.position.set(1.3, -0.82, 0);
  m.root.add(sonar);
  const mb = roundedBox(0.7, 0.08, 0.2, 0.03, MAT.carbon());
  mb.position.set(0.3, -0.98, 0);
  m.root.add(mb);
  const arm = manipulator(1.7, MAT.titanium());
  arm.position.set(1.6, -0.75, -0.35);
  m.root.add(arm);
  m.arms.push(arm);
  // floodlights around the dome
  for (const [y, z] of [[0.8, 0.8], [0.8, -0.8], [-0.6, 0.85], [-0.6, -0.85]]) addLight(m, v3(2.1, y, z), v3(1, -0.3, z * 0.2), 0.11, 18);
  addCam(m, "nose", v3(2.6, 0.9, 0), v3(1, -0.2, 0));
  addCam(m, "belly", v3(1.2, -1.0, 0.25), v3(0.3, -1, 0));
  addCam(m, "port wing", v3(0.9, 0.12, 1.75), v3(0.4, -0.2, 1));
  addCam(m, "aft", v3(-3.0, 0.5, 0), v3(-1, -0.1, 0));
  // emergency: orange drop keel latch and pop-up beacon
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 12), MAT.paint(0xff6a00, 0.4));
  beacon.position.set(-1.6, 1.0, 0.18);
  m.root.add(beacon);
  side("NEREID-X", m, -1.6, 0.62, 1.2, 1.6, 0.22, "#e8f6ff");
  return {
    ...m,
    cabin: { center: v3(1.95, 0.05, 0), radius: 0.98, viewports: [{ dir: v3(1, 0, 0), half: Math.PI / 2 - 0.05 }], eye: v3(2.15, 0.1, 0), look: v3(1, -0.12, 0).normalize(), seats: 3 },
    viewDistance: 11,
  };
}

export const BUILDERS: Record<string, () => VehicleModel> = {
  trieste: buildTrieste,
  alvin: buildAlvin,
  limiting_factor: buildLimitingFactor,
  mir: buildMir,
  nereid_x: buildNereid,
};
