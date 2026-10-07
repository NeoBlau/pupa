// Скачивает модели Sketchfab из tools/sketchfab-models.json в public/assets/sketchfab/<key>.glb
// Нужен API-токен: https://sketchfab.com/settings/password -> "API Token".
//   SKETCHFAB_TOKEN=... node tools/fetch-sketchfab.mjs
// Игра сама подхватывает скачанные модели (список пишется в public/assets/sketchfab/manifest.json),
// а для отсутствующих использует запасные модели.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/assets/sketchfab');
const TMP = path.join(ROOT, '.asset-cache/sketchfab');
const token = process.env.SKETCHFAB_TOKEN;
const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sketchfab-models.json'), 'utf8'));
const gltfTransform = path.join(ROOT, 'node_modules/.bin/gltf-transform');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

function writeManifest() {
  const have = fs.readdirSync(OUT).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ models: have }, null, 1));
  console.log('manifest:', have.join(', ') || '(пусто)');
}

if (!token) {
  console.error('SKETCHFAB_TOKEN не задан — пропускаю загрузку. Игра использует запасные модели.');
  writeManifest();
  process.exit(0);
}

for (const [key, m] of Object.entries(list)) {
  if (key.startsWith('_')) continue;
  const glb = path.join(OUT, `${key}.glb`);
  if (fs.existsSync(glb)) continue;
  try {
    let r;
    for (let k = 0; k < 8; k++) {
      r = await fetch(`https://api.sketchfab.com/v3/models/${m.uid}/download`, { headers: { Authorization: `Token ${token}` } });
      if (r.status !== 429) break;
      console.log('429, ждём', key); await new Promise((res) => setTimeout(res, 45000));
    }
    if (!r.ok) throw new Error(`download info ${r.status}`);
    const info = await r.json();
    const dir = path.join(TMP, key);
    fs.mkdirSync(dir, { recursive: true });
    let src;
    if (info.glb) {
      src = path.join(dir, 'model.glb');
      fs.writeFileSync(src, Buffer.from(await (await fetch(info.glb.url)).arrayBuffer()));
    } else {
      const zip = path.join(dir, 'model.zip');
      fs.writeFileSync(zip, Buffer.from(await (await fetch(info.gltf.url)).arrayBuffer()));
      execFileSync('python3', ['-I', '-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir]);
      src = path.join(dir, 'scene.gltf');
    }
    // Оптимизация: дедупликация, сварка вершин, ресайз текстур до 2048 и WebP.
    const tmpGlb = path.join(dir, 'opt.glb');
    execFileSync(gltfTransform, ['optimize', src, tmpGlb, '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '2048', '--simplify', 'false'], { stdio: 'inherit' });
    fs.copyFileSync(tmpGlb, glb);
    console.log('OK', key, (fs.statSync(glb).size / 1e6).toFixed(1), 'MB');
  } catch (e) {
    console.warn('FAILED', key, e.message);
  }
}
writeManifest();
