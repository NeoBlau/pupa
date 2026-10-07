// Небо, солнце (реальное положение для Москвы), облачность, туман, осадки, смена времени суток.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { settings } from '../core/settings.js';

const LAT = 55.75 * Math.PI / 180;
const LON_H = 37.62 / 15; // часы
const TZ = 3;

export const WEATHER = {
  clear:    { name: 'Ясно', cloud: 0.15, fog: 0.00016, rain: 0, snow: 0, sun: 1.0, wet: 0 },
  cloudy:   { name: 'Облачно', cloud: 0.6, fog: 0.00030, rain: 0, snow: 0, sun: 0.55, wet: 0 },
  overcast: { name: 'Пасмурно', cloud: 0.95, fog: 0.00045, rain: 0, snow: 0, sun: 0.18, wet: 0.2 },
  rain:     { name: 'Дождь', cloud: 1.0, fog: 0.0009, rain: 1, snow: 0, sun: 0.1, wet: 1 },
  snow:     { name: 'Снегопад', cloud: 1.0, fog: 0.0012, rain: 0, snow: 1, sun: 0.12, wet: 0.3 },
  fog:      { name: 'Туман', cloud: 0.9, fog: 0.0035, rain: 0, snow: 0, sun: 0.15, wet: 0.5 },
};

export const SEASONS = {
  summer: { name: 'Лето', day: 172, ground: 'summer' },
  autumn: { name: 'Осень', day: 280, ground: 'autumn' },
  winter: { name: 'Зима', day: 15, ground: 'winter' },
};

export function sunDirection(dayOfYear, clockSec, out = new THREE.Vector3()) {
  const decl = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10));
  const solarH = clockSec / 3600 - (TZ - LON_H);
  const H = (solarH - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.cos(decl) * Math.sin(H), Math.sin(decl) * Math.cos(LAT) - Math.cos(decl) * Math.sin(LAT) * Math.cos(H));
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return out;
}

const cloudVS = `
varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`;
const cloudFS = `
uniform float uTime; uniform float uCover; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uDark;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  if (d.y < 0.0) discard;
  vec2 uv = d.xz / (d.y + 0.08) * 1.4 + vec2(uTime*0.004, uTime*0.0015);
  float n = fbm(uv);
  float n2 = fbm(uv*2.7 + 3.1);
  float cov = smoothstep(1.0 - uCover, 1.15 - uCover*0.55, n*0.8 + n2*0.35);
  float thick = clamp(cov * (0.6 + n2), 0.0, 1.0);
  float sunAmt = pow(max(dot(d, uSunDir), 0.0), 6.0);
  vec3 lit = uSunCol * (0.55 + 0.6*sunAmt) * (1.0 - thick*0.55) + uAmb;
  vec3 col = mix(lit, uAmb*0.9 + uSunCol*0.12, uCover*0.6*thick);
  col *= uDark;
  float horizon = smoothstep(0.0, 0.12, d.y);
  gl_FragColor = vec4(col, cov * horizon * 0.97);
}`;

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.time = 12 * 3600; // секунды от полуночи
    this.season = 'summer';
    this.weatherKey = 'clear';
    this.weather = WEATHER.clear;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0; // 0 день … 1 ночь

    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(8000, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: cloudVS, fragmentShader: cloudFS, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
        uniforms: { uTime: { value: 0 }, uCover: { value: 0.3 }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.3, 0.35, 0.4) }, uDark: { value: 1 } },
      }),
    );
    this.clouds.renderOrder = -1;
    scene.add(this.clouds);

    // звёзды
    const sg = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 2500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      sp.push(v.x * 7500, v.y * 7500, v.z * 7500);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = settings.graphics.shadows;
    const sm = settings.graphics.quality === 'ultra' ? 4096 : settings.graphics.quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a5040, 0.8);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xbfcfe0, 0.0002);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(9000);
    this.envScene.add(this.envSky);
    this.envClouds = this.clouds.clone(); this.envClouds.material = this.clouds.material;
    this.envScene.add(this.envClouds);
    this.envRT = null;
    this.lastEnvKey = '';

    this.initPrecip();
    this.lightCallbacks = [];
  }

  initPrecip() {
    // дождь: отрезки, падающие в объёме вокруг камеры (анимация в вершинном шейдере)
    const N = 9000;
    const pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60;
      pos.set([x, y, z, x, y, z], i * 6);
      seed[i * 2] = 0; seed[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(1.5, 0.4) }, uSpeed: { value: 9.0 }, uLen: { value: 0.55 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.8) }, uOpacity: { value: 0.35 } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; uniform float uSpeed; uniform float uLen; attribute float aEnd; varying float vA;
        void main(){ vec3 p = position; float y = mod(p.y - uTime*uSpeed, 30.0); vec3 w = vec3(uWind.x, 0.0, uWind.y);
          vec3 base = vec3(mod(p.x - uCam.x + 30.0, 60.0) - 30.0, y - 8.0, mod(p.z - uCam.z + 30.0, 60.0) - 30.0) + uCam;
          base -= aEnd * (vec3(0.0, uLen, 0.0) - w*uLen/uSpeed);
          vA = 1.0 - aEnd*0.7; gl_Position = projectionMatrix * viewMatrix * vec4(base, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, uOpacity*vA); }`,
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false; this.rain.visible = false;
    this.scene.add(this.rain);

    const M = 7000;
    const sp = new Float32Array(M * 3), ph = new Float32Array(M);
    for (let i = 0; i < M; i++) { sp.set([(Math.random() - 0.5) * 60, Math.random() * 30, (Math.random() - 0.5) * 60], i * 3); ph[i] = Math.random() * 6.28; }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const flake = document.createElement('canvas'); flake.width = flake.height = 32;
    const c = flake.getContext('2d'); const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
    this.snowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uTex: { value: new THREE.CanvasTexture(flake) }, uBright: { value: 1 } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; attribute float aPh;
        void main(){ vec3 p = position; float y = mod(p.y - uTime*1.1, 30.0);
          vec3 b = vec3(mod(p.x + sin(uTime*0.6+aPh)*0.8 - uCam.x + 30.0, 60.0) - 30.0, y - 8.0, mod(p.z + cos(uTime*0.5+aPh)*0.8 - uCam.z + 30.0, 60.0) - 30.0) + uCam;
          vec4 mv = viewMatrix * vec4(b,1.0); gl_PointSize = clamp(90.0 / -mv.z, 1.0, 14.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uBright; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(uBright), t.a*0.9); }`,
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false; this.snow.visible = false;
    this.scene.add(this.snow);
  }

  setWeather(key) { this.weatherKey = key; this.weather = WEATHER[key]; this.lastEnvKey = ''; }
  setSeason(key) { this.season = key; this.lastEnvKey = ''; }

  get dayOfYear() { return SEASONS[this.season].day; }

  update(dt, camera, focus) {
    const w = this.weather;
    sunDirection(this.dayOfYear, this.time, this.sunDir);
    const el = this.sunDir.y;
    const day = THREE.MathUtils.smoothstep(el, -0.08, 0.12);
    this.night = 1 - THREE.MathUtils.smoothstep(el, -0.12, 0.04);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 3 + w.cloud * 9;
    u.rayleigh.value = 1.0 + w.cloud * 1.5 - this.night * 0.6;
    this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.envSky.material.uniforms.turbidity.value = u.turbidity.value;
    this.envSky.material.uniforms.rayleigh.value = u.rayleigh.value;

    // цвет солнца: краснеет у горизонта
    const warm = 1 - THREE.MathUtils.smoothstep(el, 0.02, 0.35);
    const sunCol = new THREE.Color(1, 0.96 - warm * 0.35, 0.9 - warm * 0.6);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.2 * day * w.sun * (0.4 + 0.6 * THREE.MathUtils.smoothstep(el, 0.0, 0.25));
    // луна ночью
    if (el < 0) {
      this.sun.color.setRGB(0.55, 0.65, 0.9);
      this.sun.intensity = 0.12 * (1 - w.cloud * 0.8) * this.night;
      this.sun.position.set(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z);
    }
    const ambDay = 0.25 + 0.95 * day * (0.5 + 0.5 * (1 - w.sun * 0.6));
    this.hemi.intensity = Math.max(0.06, ambDay * (0.7 + w.cloud * 0.5));
    this.hemi.color.setRGB(0.72 + 0.1 * w.cloud, 0.8 + 0.05 * w.cloud, 0.95).multiplyScalar(day * 0.95 + 0.05);
    this.hemi.groundColor.setRGB(this.season === 'winter' ? 0.75 : 0.36, this.season === 'winter' ? 0.78 : 0.32, this.season === 'winter' ? 0.85 : 0.25).multiplyScalar(day * 0.9 + 0.1);
    if (this.night > 0.5) this.hemi.color.setRGB(0.18, 0.22, 0.35);

    // облака
    const cu = this.clouds.material.uniforms;
    cu.uTime.value += dt * (1 + w.cloud);
    cu.uCover.value = w.cloud;
    cu.uSunDir.value.copy(this.sunDir);
    cu.uSunCol.value.copy(sunCol).multiplyScalar(day * 1.1 + 0.03);
    cu.uAmb.value.setRGB(0.32, 0.36, 0.42).multiplyScalar(day * 0.9 + 0.05);
    cu.uDark.value = 1 - w.cloud * 0.35 * (w.rain || w.snow ? 1.3 : 1);
    this.stars.material.opacity = this.night * (1 - w.cloud) * 0.9;

    // туман
    const fogDay = new THREE.Color().setRGB(0.68, 0.76, 0.86).lerp(new THREE.Color(0.62, 0.64, 0.66), w.cloud);
    if (this.weatherKey === 'snow') fogDay.setRGB(0.78, 0.8, 0.83);
    const fogNight = new THREE.Color(0.03, 0.04, 0.06);
    const fogSunset = new THREE.Color(0.85, 0.6, 0.45);
    const fc = fogDay.clone().lerp(fogSunset, warm * day * (1 - w.cloud) * 0.6).lerp(fogNight, this.night);
    this.scene.fog.color.copy(fc);
    const viewD = settings.graphics.viewDistance;
    this.scene.fog.density = Math.max(w.fog, 2.2 / viewD);
    this.renderer.toneMappingExposure = 0.75 + this.night * 0.6 - (1 - w.sun) * 0.05;

    // тени следуют за игроком
    if (focus) {
      const d = el > 0 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize();
      const texel = 140 / this.sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.set(fx + d.x * 400, focus.y + d.y * 400, fz + d.z * 400);
    }

    // осадки
    this.rain.visible = w.rain > 0; this.snow.visible = w.snow > 0;
    this.rainMat.uniforms.uTime.value += dt; this.snowMat.uniforms.uTime.value += dt;
    this.rainMat.uniforms.uCam.value.copy(camera.position); this.snowMat.uniforms.uCam.value.copy(camera.position);
    this.rainMat.uniforms.uColor.value.setRGB(0.6, 0.65, 0.7).multiplyScalar(0.3 + 0.7 * day);
    this.snowMat.uniforms.uBright.value = 0.25 + 0.75 * day;

    this.sky.position.copy(camera.position);
    this.clouds.position.copy(camera.position);
    this.stars.position.copy(camera.position);

    // карта окружения — обновляем при заметном изменении
    const key = `${Math.round(this.time / 300)}|${this.weatherKey}|${this.season}`;
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      this.envSky.position.set(0, 0, 0); this.envClouds.position.set(0, 0, 0);
      const prev = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 20000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.25 + 0.75 * day;
      if (prev) prev.dispose();
      for (const cb of this.lightCallbacks) cb(this);
    }
  }
}
