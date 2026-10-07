// Точка входа: рендерер, сцена, окружение, меню и игровой цикл.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { settings } from './core/settings.js';
import { input } from './core/input.js';
import { assets } from './core/assets.js';
import { Environment } from './world/environment.js';
import { UI } from './ui/ui.js';
import { Game, getRoute, LINES, generateRuns } from './game.js';
import { audio } from './audio/audio.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = settings.graphics.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.graphics.fov, 1, 0.08, 9500);
const env = new Environment(scene, renderer);

let composer = null, bloom = null;
function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(2, devicePixelRatio) * settings.graphics.pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = settings.graphics.fov; camera.updateProjectionMatrix();
  composer?.setSize(w, h);
}
addEventListener('resize', resize);

const app = {
  LINES, getRoute, generateRuns, game: null,
  applySettings() { resize(); audio.applyVolumes(); renderer.shadowMap.enabled = settings.graphics.shadows; env.sun.castShadow = settings.graphics.shadows; },
  async startGame(cfg) {
    ui.loading('Загрузка…', 0);
    await audio.init(); audio.resume();
    const game = new Game(renderer, scene, camera, env, cfg, ui);
    try {
      await game.init((t, p) => ui.loading(t, p));
    } catch (e) {
      console.error(e);
      ui.toast('Ошибка загрузки: ' + e.message);
      this.quitToMenu();
      return;
    }
    this.game = game;
    ui.buildHud(game);
    // прогрев: несколько кадров для компиляции шейдеров
    renderer.compile(scene, camera);
  },
  quitToMenu() {
    if (this.game) { this.game.dispose(); this.game = null; }
    document.exitPointerLock?.();
    audio.hornOff();
    paused = null;
    ui.mainMenu();
  },
};
const ui = new UI(document.getElementById('ui'), app);

let paused = null;
function togglePause() {
  const g = app.game; if (!g || g.finished) return;
  if (paused) { paused.remove(); paused = null; g.paused = false; audio.resume(); return; }
  g.paused = true; audio.hornOff();
  document.exitPointerLock?.();
  paused = ui.pausePanel(g, () => { paused = null; g.paused = false; audio.resume(); }, () => app.quitToMenu());
}

canvas.addEventListener('click', () => {
  const g = app.game;
  if (g && !g.paused && (g.rig.mode === 'walk' || g.rig.mode === 'cab') && !document.pointerLockElement) canvas.requestPointerLock?.();
});

// меню-сцена: вид на линию для фона
async function init() {
  await assets.init(renderer);
  setupComposer();
  resize();
  ui.mainMenu();
  // фоновая сцена меню: небо
  env.time = 15.5 * 3600;
  loop();
}

const clock = new THREE.Clock();
let menuAngle = 0;
function loop() {
  requestAnimationFrame(loop);
  if (window.__mcdManual) return; // ручной режим для автотестов (__mcd.step)
  frame(Math.min(0.1, clock.getDelta()));
}

function frame(dt) {
  input.update();
  const g = app.game;
  if (g) {
    if (input.pressed('pause')) togglePause();
    if (input.pressed('schedule') && !g.paused) ui.schedulePanel(g);
    if (input.pressed('hud')) settings.gameplay.hud = settings.gameplay.hud === 'full' ? 'minimal' : settings.gameplay.hud === 'minimal' ? 'off' : 'full';
    if (!g.paused) g.update(dt);
    else ui.menuGamepad();
    env.update(g.paused ? 0 : dt * g.timeScale, camera, camera.position);
    ui.updateHud(dt);
  } else {
    ui.menuGamepad();
    menuAngle += dt * 0.02;
    camera.position.set(0, 2, 0);
    camera.lookAt(Math.sin(menuAngle) * 10, 2.6, Math.cos(menuAngle) * 10);
    env.update(dt, camera, camera.position);
  }
  if (settings.graphics.bloom && composer) {
    bloom.strength = 0.18 + env.night * 0.5;
    composer.render();
  } else renderer.render(scene, camera);
  input.endFrame();
}

// для отладки и автотестов
window.__mcd = {
  app, env, renderer, scene, camera, input, settings,
  step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) frame(dt); },
};
init();
