/**
 * The 3D world of a dive: sky and sun, sea surface, underwater medium,
 * particles, seafloor and scenery, marine life, the submersible model with its
 * cockpit, first/third-person cameras, hull-camera feeds and a forward sonar.
 */
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { veilingColour, waterColour } from "../science/optics";
import type { WaveComponent } from "../science/waves";
import type { Relief } from "../sim/terrain";
import type { Controls, SubState, Submersible } from "../sim/submersible";
import { beamRGB, kdRGB, LightShafts, medium, patchObject, SeaSurface, Waterline } from "./water";
import { Particles } from "./particles";
import { reefScenery, Seafloor, ventScenery, type Scenery } from "./biomes";
import { Ecosystem, type CraftInfo } from "./life/ecosystem";
import { BUILDERS, type VehicleModel } from "./vehicles/models";
import { Cockpit, type CockpitData } from "./vehicles/cockpit";

/** Display brightness from relative luminance: 1 → 1, 1e-7 → 0 (log, ≈ the dark-adapted eye). */
export const displayBrightness = (lum: number) => Math.pow(Math.min(1, Math.max(0, (Math.log10(Math.max(lum, 1e-12)) + 7) / 7)), 1.4);

/**
 * Solar elevation [rad] (NOAA low-precision algorithm): declination
 * δ = 23.44°·sin(2π(284+n)/365), hour angle from local solar time.
 */
export function solarElevation(latDeg: number, dayOfYear: number, solarHour: number): { elev: number; az: number } {
  const d = (23.44 * Math.PI / 180) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const phi = (latDeg * Math.PI) / 180;
  const H = ((solarHour - 12) * 15 * Math.PI) / 180;
  const sinE = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
  const elev = Math.asin(sinE);
  const az = Math.atan2(-Math.sin(H), Math.tan(d) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)); // from north, clockwise
  return { elev, az };
}

export interface WorldSetup {
  vehicleId: string;
  missionId?: string;
  bottom: number;
  relief: Relief;
  chl: number;
  waves: WaveComponent[];
  lat: number;
  dayOfYear: number;
  regionTags: string[];
}

export type CamMode = "first" | "third";

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
  private sky = new Sky();
  private sun = new THREE.DirectionalLight(0xffffff, 3);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1);
  private surface!: SeaSurface;
  private waterline!: Waterline;
  private shafts: LightShafts;
  readonly particles = new Particles();
  seafloor!: Seafloor;
  private scenery: Scenery | null = null;
  ecosystem!: Ecosystem;
  model!: VehicleModel;
  private cockpit!: Cockpit;
  camMode: CamMode = "third";
  private orbit = { yaw: Math.PI * 0.85, pitch: 0.18, dist: 12 };
  private look = { yaw: 0, pitch: 0 };
  private feeds: Array<{ rt: THREE.WebGLRenderTarget; cam: THREE.PerspectiveCamera; mount: { pos: THREE.Vector3; dir: THREE.Vector3 } }> = [];
  private feedIndex = 0;
  private setupData!: WorldSetup;
  private strobeT = 0;
  private sunDir = new THREE.Vector3(0.3, 0.9, 0.2).normalize();
  private sonar: number[] = new Array(32).fill(0);
  private tmpV = new THREE.Vector3();
  private armT = 0;
  private lastTrack = new THREE.Vector2(1e9, 1e9);
  track: Array<[number, number]> = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.sky.scale.setScalar(2500);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 3; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    this.shafts = new LightShafts(new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/godray.webp`));
    this.scene.add(this.shafts.group, this.particles.group);
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  async setup(s: WorldSetup, sub: Submersible) {
    this.setupData = s;
    // clear previous dive
    for (const o of [this.surface?.mesh, this.waterline?.mesh, this.seafloor?.mesh, this.scenery?.group, this.ecosystem?.group, this.model?.root]) if (o) this.scene.remove(o);
    this.ecosystem?.dispose();
    this.track = [];
    medium.uBeam.value.copy(beamRGB(s.chl));
    medium.uKd.value.copy(kdRGB(s.chl));
    this.surface = new SeaSurface(s.waves);
    this.waterline = new Waterline(s.waves);
    this.scene.add(this.surface.mesh);
    this.camera.add(this.waterline.mesh);
    this.scene.add(this.camera);
    this.seafloor = new Seafloor(s.relief, s.bottom, s.missionId === "tag_vents" ? 0x8a7f73 : s.bottom > 3000 ? 0xb8b0a0 : 0xffffff);
    this.scene.add(this.seafloor.mesh);
    // vehicle
    this.model = BUILDERS[s.vehicleId]();
    patchObject(this.model.root);
    this.cockpit = new Cockpit(this.model, s.vehicleId);
    this.scene.add(this.model.root);
    this.orbit.dist = this.model.viewDistance;
    this.feeds = this.model.cams.slice(0, 3).map((mount) => {
      const rt = new THREE.WebGLRenderTarget(320, 180);
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      return { rt, cam: new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400), mount };
    });
    // life and scenery
    this.ecosystem = new Ecosystem({
      floor: (x, z) => this.seafloor.depthAt(x, z),
      obstacles: [],
      missionId: s.missionId,
      regionTags: s.regionTags,
    });
    this.scene.add(this.ecosystem.group);
    this.scenery = null;
    if (s.missionId === "reef_guam") this.scenery = await reefScenery(this.seafloor);
    else if (s.missionId === "tag_vents") this.scenery = ventScenery(this.seafloor);
    if (this.scenery) {
      this.scene.add(this.scenery.group);
      (this.ecosystem as unknown as { world: { obstacles: Scenery["obstacles"] } }).world.obstacles = this.scenery.obstacles;
    }
    void sub;
    this.resize();
  }

  /** Obstacles in physics coordinates (x east, y north, z down). */
  physicsObstacles() {
    return (this.scenery?.obstacles ?? []).map((o) => ({ x: o.pos.x, y: -o.pos.z, z: -o.pos.y, r: o.r }));
  }

  toggleCamera() {
    this.camMode = this.camMode === "first" ? "third" : "first";
    this.look = { yaw: 0, pitch: -0.18 };
    return this.camMode;
  }

  lookInput(dx: number, dy: number, zoom: number) {
    if (this.camMode === "third") {
      this.orbit.yaw -= dx;
      this.orbit.pitch = Math.max(-1.2, Math.min(1.3, this.orbit.pitch + dy));
      this.orbit.dist = Math.max(this.model.viewDistance * 0.4, Math.min(this.model.viewDistance * 3, this.orbit.dist * (1 + zoom * 0.1)));
    } else {
      this.look.yaw = Math.max(-1.3, Math.min(1.3, this.look.yaw - dx));
      this.look.pitch = Math.max(-0.9, Math.min(0.9, this.look.pitch - dy));
    }
  }

  armAction() { this.armT = 3; }

  /** Physics state → three transform. */
  private placeVehicle(s: SubState, ctl: Controls, t: number, eta: number) {
    const r = this.model.root;
    r.position.set(s.x, -s.z, -s.y);
    // small attitude changes: pitch with vertical speed, roll with yaw rate, wave tilt at the surface
    const surf = 1 - s.submerged;
    const pitch = THREE.MathUtils.clamp(-s.w * 0.05, -0.12, 0.12) + surf * 0.05 * Math.sin(t * 0.9);
    const roll = THREE.MathUtils.clamp(-s.yawRate * 0.3, -0.12, 0.12) + surf * 0.07 * Math.sin(t * 0.7 + 1);
    r.rotation.set(roll, s.heading, pitch, "YXZ");
    void eta;
    // thrusters spin with their command
    const cmd: Record<string, number> = { surge: ctl.surge, sway: ctl.sway, heave: ctl.heave, yaw: ctl.yaw };
    for (const th of this.model.thrusters) {
      const prop = th.obj.getObjectByName("prop");
      if (prop) prop.rotation.x += cmd[th.role] * 0.6;
    }
    // lights
    for (const l of this.model.lights) {
      const spot = l.getObjectByName("spot") as THREE.SpotLight;
      spot.intensity = ctl.lights ? 60 : 0;
      const beam = l.getObjectByName("beam") as THREE.Mesh;
      (beam.material as THREE.ShaderMaterial).uniforms.uOn.value = ctl.lights && s.z > 3 ? 1 : 0;
      const lens = l.getObjectByName("lens") as THREE.Mesh;
      (lens.material as THREE.MeshStandardMaterial).emissiveIntensity = ctl.lights ? 4 : 0.05;
    }
    // recovery strobes flash once per second when surfaced
    this.strobeT += 0.016;
    for (const st of this.model.strobes) {
      const lamp = st.getObjectByName("strobe") as THREE.Mesh;
      (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = s.submerged < 0.98 && (this.strobeT % 1) < 0.08 ? 20 : 0;
    }
    for (const w of this.model.descentWeights) w.visible = s.descentWeightsOn;
    for (const w of this.model.ascentWeights) w.visible = s.ascentWeightsOn;
    // manipulator: extend to sample, then stow
    for (const arm of this.model.arms) {
      const u = arm.userData as { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group };
      const k = this.armT > 0 ? Math.sin(Math.min(1, (3 - this.armT) / 1.2) * Math.PI / 2) * (this.armT < 1 ? this.armT : 1) : 0;
      u.shoulder.rotation.z = -0.9 + 0.7 * k;
      u.elbow.rotation.z = 1.9 - 1.6 * k;
      u.wrist.rotation.z = -0.8 + 0.5 * k;
    }
  }

  private updateCamera(dt: number) {
    const root = this.model.root;
    root.updateMatrixWorld(true);
    if (this.camMode === "first") {
      const eye = this.model.cabin.eye.clone().applyMatrix4(root.matrixWorld);
      const dir = this.model.cabin.look.clone();
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.look.yaw);
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      dir.applyAxisAngle(right, this.look.pitch);
      dir.transformDirection(root.matrixWorld);
      this.camera.position.copy(eye);
      this.camera.lookAt(eye.clone().add(dir));
      this.camera.near = 0.02;
    } else {
      const target = root.position.clone();
      const heading = root.rotation.y;
      const yaw = heading + this.orbit.yaw;
      const want = new THREE.Vector3(
        target.x + Math.cos(yaw) * Math.cos(this.orbit.pitch) * this.orbit.dist,
        target.y + Math.sin(this.orbit.pitch) * this.orbit.dist,
        target.z - Math.sin(yaw) * Math.cos(this.orbit.pitch) * this.orbit.dist,
      );
      // stay above the seafloor
      const fl = -this.seafloor.depthAt(want.x, want.z) + 1;
      want.y = Math.max(want.y, fl);
      this.camera.position.lerp(want, Math.min(1, dt * 4));
      this.camera.lookAt(target);
      this.camera.near = 0.05;
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  private computeSonar() {
    const root = this.model.root;
    const origin = root.position;
    const heading = root.rotation.y;
    const R = 100, n = this.sonar.length;
    const creatures: THREE.Vector3[] = [];
    this.ecosystem.group.children.forEach((c) => creatures.push(c.position));
    for (let i = 0; i < n; i++) {
      const b = heading + ((60 - (120 * (i + 0.5)) / n) * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(b), -Math.tan(0.17), -Math.sin(b)).normalize();
      let hit = 0;
      for (let d = 2; d <= R; d += 2) {
        const p = this.tmpV.copy(origin).addScaledVector(dir, d);
        if (-p.y >= this.seafloor.depthAt(p.x, p.z)) { hit = d / R; break; }
        if (creatures.some((c) => c.distanceToSquared(p) < 4)) { hit = d / R; break; }
        if ((this.scenery?.obstacles ?? []).some((o) => o.pos.distanceTo(p) < o.r)) { hit = d / R; break; }
      }
      this.sonar[i] = hit;
    }
  }

  frame(sub: Submersible, dt: number, info: { t: number; solarHour: number; lang: "ru" | "en"; warnings: string[] }) {
    const s = sub.state;
    const ctl = sub.controls;
    const S = this.setupData;
    medium.uTime.value += dt;
    // sun
    const { elev, az } = solarElevation(S.lat, S.dayOfYear, info.solarHour);
    this.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    medium.uSunDir.value.copy(this.sunDir);
    const day = Math.max(Math.sin(elev), 0) + 0.0008; // + moon/starlight
    // camera & vehicle
    const eta = 0;
    this.placeVehicle(s, ctl, s.t, eta);
    this.updateCamera(dt);
    const camDepth = -this.camera.position.y;
    const under = camDepth > 0;
    medium.uCamUnder.value = under ? 1 : 0;
    const wc = waterColour(Math.max(camDepth, 0), S.chl);
    const lum = wc.luminance * day;
    const bright = displayBrightness(lum);
    // in-scattered (veiling) light of the water body: bright cyan-blue in the photic zone, black in the deep
    const vc = veilingColour(Math.max(camDepth, 0), S.chl);
    const scatter = new THREE.Color(vc.rgb[0], vc.rgb[1], vc.rgb[2]).multiplyScalar(0.55 * bright);
    medium.uScatter.value.copy(scatter);
    medium.uSurfaceLight.value = Math.min(1, day * 1.2);
    medium.uCaustics.value = under ? 1 : 0.4;
    this.sky.visible = !under;
    // the eye adapts: bright daylight sky above water, dimmer scene underwater
    this.renderer.toneMappingExposure = under ? 1 : 0.5;
    this.scene.background = under ? scatter : null;
    // lights: sun colour tinted by the water above the camera
    const sunCol = under ? new THREE.Color(wc.rgb[0], wc.rgb[1], wc.rgb[2]) : new THREE.Color(1, 0.97, 0.92);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3 * day * (under ? bright : 1);
    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, 50);
    this.sun.target.position.copy(this.camera.position);
    this.hemi.color.copy(under ? scatter.clone().multiplyScalar(2) : new THREE.Color(0.6, 0.75, 1));
    // upwelling light (irradiance reflectance of the ocean ≈ 2–5 %, stronger over sand) fills from below
    this.hemi.groundColor.copy(under ? scatter.clone().multiplyScalar(0.8) : new THREE.Color(0x2a3a4a));
    this.hemi.intensity = under ? 3.2 * bright : 1.2 * day + 0.02;
    // surface & transition
    this.surface.update(this.camera, s.t);
    (this.surface.uniforms.uSkyZenith.value as THREE.Color).setRGB(0.16, 0.35, 0.75).multiplyScalar(Math.min(1, day * 2));
    (this.surface.uniforms.uSkyHorizon.value as THREE.Color).setRGB(0.72, 0.82, 0.92).multiplyScalar(Math.min(1, day * 2));
    this.waterline.update(this.camera, s.t, Math.abs(this.camera.position.y) < 2.5);
    this.shafts.update(this.camera, this.sunDir, under ? 0.35 * day * Math.exp(-0.05 * camDepth) : 0);
    this.seafloor.update(this.camera.position);
    this.scenery?.update?.(s.t);
    // particles and bubbles
    const vel = new THREE.Vector3(s.u, -s.w, -s.v);
    this.particles.update(this.camera.position, vel, dt, { brightness: bright, lightsOn: ctl.lights, depth: camDepth, t: s.t });
    const root = this.model.root;
    if (s.submerged < 1 && s.submerged > 0.2 && Math.random() < 0.5) {
      for (const v of this.model.vents) this.particles.emit(v.clone().applyMatrix4(root.matrixWorld), 1, 0.004);
    }
    if (!ctl.mbtBlow && s.mbtAir > 0.02) for (const v of this.model.vents.slice(-2)) this.particles.emit(v.clone().applyMatrix4(root.matrixWorld), 3, 0.006);
    if (s.z < 60 && (Math.abs(ctl.surge) > 0.6 || Math.abs(ctl.heave) > 0.6) && Math.random() < 0.3) {
      for (const th of this.model.thrusters) this.particles.emit(th.obj.getWorldPosition(this.tmpV).clone(), 1, 0.002);
    }
    // marine life
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    const craft: CraftInfo = { pos: root.position.clone(), vel, forward: fwd, lightsOn: ctl.lights, noise: (Math.abs(ctl.surge) + Math.abs(ctl.heave) + Math.abs(ctl.sway)) / 3 };
    this.ecosystem.update(dt, craft);
    if (this.armT > 0) this.armT -= dt;
    // track for the nav display
    if (Math.hypot(s.x - this.lastTrack.x, s.y - this.lastTrack.y) > 2) {
      this.lastTrack.set(s.x, s.y);
      this.track.push([s.x, s.y]);
      if (this.track.length > 500) this.track.shift();
    }
    // cockpit (first person only): displays, hull camera feeds, sonar
    if (this.camMode === "first") {
      if (this.feeds.length) {
        const f = this.feeds[this.feedIndex++ % this.feeds.length];
        f.cam.position.copy(f.mount.pos).applyMatrix4(root.matrixWorld);
        f.cam.lookAt(f.cam.position.clone().add(f.mount.dir.clone().transformDirection(root.matrixWorld)));
        this.renderer.setRenderTarget(f.rt);
        this.renderer.render(this.scene, f.cam);
        this.renderer.setRenderTarget(null);
      }
      if (Math.floor(s.t * 4) !== Math.floor((s.t - dt) * 4)) this.computeSonar();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Update cockpit screens (called by the dive controller a few times per second). */
  updateCockpit(data: Omit<CockpitData, "track" | "sonar" | "sonarRange" | "camFeeds" | "x" | "y">, s: SubState) {
    if (this.camMode !== "first") return;
    this.cockpit.update({ ...data, track: this.track, x: s.x, y: s.y, sonar: this.sonar, sonarRange: 100, camFeeds: this.feeds.map((f) => f.rt.texture) });
  }

  snapshot() { return this.canvas.toDataURL("image/png"); }
}
