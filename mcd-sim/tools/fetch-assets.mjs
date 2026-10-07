// Скачивает свободные (CC0) ассеты Poly Haven и модели людей из примеров three.js
// в public/assets. Повторный запуск пропускает уже скачанные файлы.
//   node tools/fetch-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/assets');
const TMP = path.join(ROOT, '.asset-cache');

// Модели окружения (Poly Haven, CC0). Ключ — имя файла в public/assets/models.
export const MODELS = [
  'street_lamp_01', 'street_lamp_02', 'modular_electricity_poles', 'modular_chainlink_fence',
  'modular_urban_apartments_facade', 'modular_factory_facade', 'pine_tree_01', 'fir_tree_01',
  'tree_small_02', 'shrub_01', 'shrub_02', 'shrub_04', 'grass_medium_01', 'painted_wooden_bench',
  'metal_trash_can', 'utility_box_01', 'utility_box_02', 'security_camera_01', 'concrete_road_barrier',
  'power_box_01', 'modular_street_seating', 'mounted_fluorescent_lights', 'exterior_aircon_unit',
  'covered_car', 'rollershutter_door', 'dead_tree_trunk',
];

// PBR-текстуры (Poly Haven, CC0): diff + nor_gl + arm (AO/Rough/Metal).
export const TEXTURES = [
  'gravel_stones', 'rocky_gravel', 'sparse_grass', 'forest_ground_04', 'withered_grass',
  'square_concrete_pavers', 'anti_slip_concrete', 'concrete_panels', 'concrete_tile_facade', 'leafy_grass', 'grass_path_2', 'aerial_grass_rock',
  'precast_concrete_wall', 'red_brick', 'box_profile_metal_sheet', 'corrugated_iron_02', 'metal_plate',
  'rusty_metal', 'rough_concrete', 'asphalt_02', 'snow_02', 'factory_wall', 'brushed_concrete',
];

const PEOPLE = ['Soldier.glb', 'Michelle.glb', 'readyplayer.me.glb'];

async function get(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
    }
  }
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const gltfTransform = path.join(ROOT, 'node_modules/.bin/gltf-transform');

async function fetchModel(id) {
  const glb = path.join(OUT, 'models', `${id}.glb`);
  if (fs.existsSync(glb)) return;
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  const res = files.gltf['1k'] ? '1k' : Object.keys(files.gltf).pop();
  const entry = files.gltf[res].gltf;
  const dir = path.join(TMP, id);
  await get(entry.url, path.join(dir, `${id}.gltf`));
  for (const [rel, f] of Object.entries(entry.include)) await get(f.url, path.join(dir, rel));
  fs.mkdirSync(path.dirname(glb), { recursive: true });
  // Упаковка в GLB + сжатие текстур в WebP (меньше вес, тот же вид).
  execFileSync(gltfTransform, ['copy', path.join(dir, `${id}.gltf`), path.join(dir, 'packed.glb')], { stdio: 'ignore' });
  execFileSync(gltfTransform, ['webp', path.join(dir, 'packed.glb'), glb, '--quality', '88'], { stdio: 'ignore' });
  console.log('model', id, (fs.statSync(glb).size / 1e6).toFixed(1), 'MB');
}

async function fetchTexture(id) {
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  const pick = (k) => (files[k] && (files[k]['1k'] || files[k]['2k']))?.jpg?.url;
  const maps = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') };
  for (const [k, url] of Object.entries(maps)) {
    if (!url) continue;
    const jpg = path.join(TMP, 'tex', `${id}_${k}.jpg`);
    const webp = path.join(OUT, 'textures', `${id}_${k}.webp`);
    if (fs.existsSync(webp)) continue;
    await get(url, jpg);
    fs.mkdirSync(path.dirname(webp), { recursive: true });
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', jpg, '-quality', '86', webp]);
  }
  console.log('texture', id);
}

const pool = async (items, n, fn) => {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) {
      const it = q.shift();
      try { await fn(it); } catch (e) { console.warn('FAILED', it, e.message); }
    }
  }));
};

await pool(MODELS, 4, fetchModel);
await pool(TEXTURES, 4, fetchTexture);
await pool(PEOPLE, 3, (f) => get(`https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/${f}`, path.join(OUT, 'people', f)));
console.log('done');
