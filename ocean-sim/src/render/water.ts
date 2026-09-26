/**
 * Water rendering.
 *
 * 1. Medium: every lit material is patched so the colour reaching the camera
 *    is attenuated per RGB channel along the underwater part of the view ray,
 *      C = C₀·exp(−c·L) + C_∞·(1 − exp(−c·L)),
 *    with beam attenuation c = a_w + b (Pope & Fry 1997; b = 0.30·Chl^0.62,
 *    Morel 1988). Red is absorbed within a few metres, blue travels furthest.
 *    Caustics are added on upward-facing surfaces, fading as exp(−K_d·z).
 * 2. Surface: the same linear wave components that move the submersible.
 *    From above: Fresnel mix of sky reflection and water body + sun glint.
 *    From below: Snell's window — sky visible inside the 48.6° cone, total
 *    internal reflection outside.
 * 3. Waterline: when the camera's near plane straddles the surface, the part
 *    below the local wave height is tinted, so crossing the surface is continuous.
 * 4. Light shafts: additive sheets aligned with the refracted sun direction.
 */
import * as THREE from "three";
import { kdSpectrum, POPE_FRY_1997 } from "../science/optics";
import type { WaveComponent } from "../science/waves";

export const MAX_WAVES = 24;

const aw = (l: number) => {
  let best = POPE_FRY_1997[0];
  for (const p of POPE_FRY_1997) if (Math.abs(p[0] - l) < Math.abs(best[0] - l)) best = p;
  return best[1];
};

/** Beam attenuation c(λ) at the R, G, B wavelengths (600, 550, 460 nm) [1/m]. */
export function beamRGB(chl: number): THREE.Vector3 {
  const b = 0.3 * Math.pow(Math.max(chl, 0.01), 0.62) + 0.01; // particulate + molecular scattering
  return new THREE.Vector3(aw(600) + b, aw(550) + b, aw(460) + b);
}

/** Diffuse attenuation K_d at R, G, B. */
export function kdRGB(chl: number): THREE.Vector3 {
  const kd = kdSpectrum(chl);
  const at = (l: number) => kd[POPE_FRY_1997.findIndex(([x]) => x === l)];
  return new THREE.Vector3(at(600), at(550), at(460));
}

/** Uniforms shared by every patched material (updated once per frame). */
export const medium = {
  uCamUnder: { value: 1 },
  uBeam: { value: new THREE.Vector3(0.25, 0.07, 0.03) },
  uKd: { value: new THREE.Vector3(0.25, 0.07, 0.03) },
  uScatter: { value: new THREE.Color(0.02, 0.2, 0.35) },
  uSurfaceLight: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
  uTime: { value: 0 },
  uCaustics: { value: 1 },
};

const MEDIUM_PARS = /* glsl */ `
uniform float uCamUnder;
uniform vec3 uBeam;
uniform vec3 uKd;
uniform vec3 uScatter;
uniform float uSurfaceLight;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCaustics;
varying vec3 vWPos;
float causticTile(vec2 p) {
  // two scrolling layers of folded sine ridges ≈ focusing by surface waves
  vec2 q = p;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    q = vec2(q.x + 0.7 * sin(q.y * 1.3 + uTime * 0.9), q.y + 0.7 * cos(q.x * 1.1 - uTime * 0.7));
    c += 1.0 / (1.0 + 40.0 * abs(sin(q.x) * sin(q.y)));
  }
  return c / 3.0;
}
vec3 waterPathC(vec3 col, vec3 wpos, vec3 scatter) {
  float L;
  if (uCamUnder > 0.5) {
    L = distance(cameraPosition, wpos);
    if (wpos.y > 0.0) L *= clamp(-cameraPosition.y / max(wpos.y - cameraPosition.y, 1e-3), 0.0, 1.0);
  } else {
    if (wpos.y >= 0.0) return col;
    float f = cameraPosition.y / max(cameraPosition.y - wpos.y, 1e-3);
    L = distance(cameraPosition, wpos) * (1.0 - f);
  }
  vec3 T = exp(-uBeam * L);
  return col * T + scatter * (1.0 - T);
}
// linear-space variant (custom shaders that encode colour afterwards)
vec3 waterPath(vec3 col, vec3 wpos) { return waterPathC(col, wpos, uScatter); }
`;

const MEDIUM_FRAG = /* glsl */ `
#ifdef USE_MEDIUM_CAUSTICS
{
  float depth = max(-vWPos.y, 0.0);
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float up = clamp(wN.y, 0.0, 1.0);
  vec2 cp = (vWPos.xz + uSunDir.xz / max(uSunDir.y, 0.2) * depth) * 0.35;
  float c = causticTile(cp);
  vec3 lightAt = exp(-uKd * depth) * uSurfaceLight;
  gl_FragColor.rgb += diffuseColor.rgb * c * up * lightAt * 1.6 * uCaustics * step(0.0, -vWPos.y);
}
#endif
// fog_fragment runs after tone mapping and sRGB encoding: blend toward the encoded water colour
gl_FragColor.rgb = waterPathC(gl_FragColor.rgb, vWPos, sRGBTransferOETF(vec4(uScatter, 1.0)).rgb);
`;

/** Patch a material in place so it is seen through the water medium. */
export function patchMaterial(mat: THREE.Material, caustics = true) {
  const m = mat as THREE.Material & { __medium?: boolean };
  if (m.__medium) return;
  m.__medium = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    Object.assign(shader.uniforms, medium);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWPos = (modelMatrix * wp).xyz;
        }`,
      );
    const hasNormal = shader.fragmentShader.includes("#include <normal_fragment_begin>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + MEDIUM_PARS)
      .replace("#include <fog_fragment>", (caustics && hasNormal ? "#define USE_MEDIUM_CAUSTICS\n" : "") + MEDIUM_FRAG);
  };
  mat.customProgramCacheKey = () => `medium-${caustics}`;
  (mat as THREE.Material & { fog?: boolean }).fog = false;
  mat.needsUpdate = true;
}

export function patchObject(root: THREE.Object3D, caustics = true) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mt of mats) if (!(mt instanceof THREE.ShaderMaterial)) patchMaterial(mt, caustics);
  });
}

const WAVE_GLSL = /* glsl */ `
uniform vec4 uWaves[${MAX_WAVES}]; // amp, k, omega, phase
uniform vec2 uDirs[${MAX_WAVES}];
uniform float uWaveTime;
float waveEta(vec2 p, out vec2 grad) {
  float e = 0.0; grad = vec2(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 w = uWaves[i];
    float th = w.y * dot(p, uDirs[i]) - w.z * uWaveTime + w.w;
    e += w.x * cos(th);
    grad += -w.x * w.y * sin(th) * uDirs[i];
  }
  return e;
}
`;

/** Waves are evaluated in physics coordinates (x east, y north) = three (x, −z). */
export function waveUniforms(waves: WaveComponent[]) {
  const sorted = [...waves].filter((c) => c.k > 0.02).sort((a, b) => b.amp - a.amp).slice(0, MAX_WAVES);
  const W = Array.from({ length: MAX_WAVES }, (_, i) => {
    const c = sorted[i];
    return c ? new THREE.Vector4(c.amp, c.k, c.omega, c.phase) : new THREE.Vector4(0, 0, 0, 0);
  });
  const D = Array.from({ length: MAX_WAVES }, (_, i) => {
    const c = sorted[i];
    return c ? new THREE.Vector2(Math.cos(c.dir), Math.sin(c.dir)) : new THREE.Vector2(1, 0);
  });
  return { uWaves: { value: W }, uDirs: { value: D }, uWaveTime: { value: 0 } };
}

/** Sea surface mesh (follows the camera horizontally). */
export class SeaSurface {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private spacing: number;

  constructor(waves: WaveComponent[], size = 900, seg = 300) {
    this.spacing = size / seg;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    this.uniforms = {
      ...waveUniforms(waves),
      ...medium,
      uSkyZenith: { value: new THREE.Color(0.16, 0.35, 0.75) },
      uSkyHorizon: { value: new THREE.Color(0.72, 0.82, 0.92) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uBody: { value: new THREE.Color(0.0, 0.12, 0.2) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      vertexShader: /* glsl */ `
        ${WAVE_GLSL}
        varying vec3 vWPos;
        varying vec2 vGrad;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec2 grad;
          wp.y += waveEta(vec2(wp.x, -wp.z), grad);
          vGrad = grad;
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${MEDIUM_PARS}
        uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon; uniform vec3 uSunColor; uniform vec3 uBody;
        varying vec2 vGrad;
        vec3 sky(vec3 d) {
          float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(uSkyHorizon, uSkyZenith, pow(h, 0.45));
          float s = max(dot(d, uSunDir), 0.0);
          return (c + uSunColor * (pow(s, 900.0) * 30.0 + pow(s, 12.0) * 0.25)) * uSurfaceLight;
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          // capillary ripples on top of the resolved spectrum
          vec2 p = vWPos.xz * 1.7 + vec2(uTime * 0.6, uTime * 0.4);
          vec2 rip = vec2(noise(p) - noise(p + vec2(3.1, 0.0)), noise(p + vec2(0.0, 5.7)) - noise(p + vec2(1.3, 2.2))) * 0.12;
          vec3 n = normalize(vec3(-(vGrad.x + rip.x), 1.0, (vGrad.y + rip.y)));
          vec3 V = normalize(cameraPosition - vWPos);
          vec3 col; float alpha = 1.0;
          if (gl_FrontFacing && cameraPosition.y > vWPos.y - 0.02) {
            float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            vec3 R = reflect(-V, n);
            R.y = abs(R.y);
            vec3 refr = uBody * uSurfaceLight * (0.6 + 0.4 * max(dot(n, uSunDir), 0.0));
            col = mix(refr, sky(R), F);
            alpha = mix(0.82, 1.0, F);
          } else {
            // seen from below: Snell's window
            vec3 nd = -n;
            float cosI = clamp(dot(V, nd), 0.0, 1.0);
            float sinT = 1.333 * sqrt(1.0 - cosI * cosI);
            if (sinT >= 1.0) {
              col = uScatter * 1.15; // total internal reflection of the water body
            } else {
              vec3 T = refract(-V, nd, 1.333);
              float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
              col = mix(sky(normalize(-T) * vec3(1.0, 1.0, 1.0)) * 0.9, uScatter, F);
            }
            col = waterPath(col, vWPos);
          }
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(camera: THREE.Camera, t: number) {
    const s = this.spacing;
    this.mesh.position.set(Math.round(camera.position.x / s) * s, 0, Math.round(camera.position.z / s) * s);
    this.uniforms.uWaveTime.value = t;
  }
}

/** Full-screen waterline overlay for a camera crossing the surface. */
export class Waterline {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(waves: WaveComponent[]) {
    this.uniforms = { ...waveUniforms(waves), ...medium, uInvVP: { value: new THREE.Matrix4() }, uCamY: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: /* glsl */ `
        ${WAVE_GLSL}
        uniform mat4 uInvVP; uniform vec3 uScatter; uniform float uSurfaceLight; uniform float uCamUnder;
        varying vec2 vUv;
        void main() {
          vec4 p = uInvVP * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
          p /= p.w;
          vec2 g;
          float e = waveEta(vec2(p.x, -p.z), g);
          float d = p.y - e;
          float line = smoothstep(0.02, 0.0, abs(d));
          if (uCamUnder < 0.5 && d < 0.0) {
            gl_FragColor = vec4(uScatter * 1.1 + 0.05 * uSurfaceLight, 0.88);
          } else if (uCamUnder > 0.5 && d > 0.0) {
            gl_FragColor = vec4(vec3(0.75, 0.85, 0.95) * uSurfaceLight, 0.35);
          } else {
            gl_FragColor = vec4(0.0);
          }
          gl_FragColor = mix(gl_FragColor, vec4(vec3(0.9) * uSurfaceLight, 0.9), line);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
  }

  update(camera: THREE.Camera, t: number, near: boolean) {
    this.mesh.visible = near;
    this.uniforms.uWaveTime.value = t;
    (this.uniforms.uInvVP.value as THREE.Matrix4).multiplyMatrices(camera.matrixWorld, (camera as THREE.PerspectiveCamera).projectionMatrixInverse);
  }
}

/** Crepuscular light shafts below the surface (additive sheets). */
export class LightShafts {
  readonly group = new THREE.Group();
  private sheets: THREE.Mesh[] = [];
  private mat: THREE.ShaderMaterial;

  constructor(tex: THREE.Texture) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uIntensity: { value: 1 }, uTime: medium.uTime, uColor: { value: new THREE.Color(0.6, 0.85, 1) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uIntensity; uniform float uTime; uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float shimmer = 0.6 + 0.4 * sin(vUv.x * 12.0 + uTime * 0.8) * sin(vUv.x * 5.3 - uTime * 0.5);
          float fade = pow(vUv.y, 1.6) * smoothstep(1.0, 0.93, vUv.y) * smoothstep(0.0, 0.45, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
          float t = texture2D(uTex, vec2(vUv.x, 0.5)).r;
          gl_FragColor = vec4(uColor * uIntensity * fade * shimmer * (0.4 + t), 1.0);
        }`,
    });
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6 + Math.random() * 2.2, 70), this.mat);
      m.geometry.translate(0, -35, 0);
      m.userData.offset = new THREE.Vector2((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60);
      this.sheets.push(m);
      this.group.add(m);
    }
    this.group.renderOrder = 3;
  }

  update(camera: THREE.Camera, sunDir: THREE.Vector3, intensity: number) {
    this.group.visible = intensity > 0.005;
    this.mat.uniforms.uIntensity.value = intensity;
    // refracted sun direction in water (Snell): sinθw = sinθa / 1.333
    const sinA = Math.sqrt(Math.max(0, 1 - sunDir.y * sunDir.y));
    const sinW = sinA / 1.333;
    const tilt = Math.asin(sinW);
    const az = Math.atan2(sunDir.z, sunDir.x);
    for (const s of this.sheets) {
      const o = s.userData.offset as THREE.Vector2;
      s.position.set(camera.position.x + o.x, 0, camera.position.z + o.y);
      s.rotation.set(0, 0, 0);
      s.lookAt(camera.position.x, s.position.y, camera.position.z);
      s.rotateOnWorldAxis(new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)), -tilt);
    }
  }
}
