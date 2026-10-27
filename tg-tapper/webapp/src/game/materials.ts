// PBR materials. Surfaces use 4K CC0 textures from Poly Haven (public/tex, see LICENSE.md);
// labels and decals are drawn procedurally at 2K.

import * as THREE from 'three';

type Set = { diff: THREE.Texture; nor: THREE.Texture; rough: THREE.Texture };

async function loadSet(r: THREE.WebGLRenderer, name: string, repeat: number): Promise<Set> {
  const L = new THREE.TextureLoader();
  const [diff, nor, rough] = await Promise.all(['diff', 'nor', 'rough'].map((m) => L.loadAsync(`tex/${name}/${m}.webp`)));
  const aniso = r.capabilities.getMaxAnisotropy();
  for (const t of [diff, nor, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = aniso;
  }
  diff.colorSpace = THREE.SRGBColorSpace;
  return { diff, nor, rough };
}

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function label(text: string, sub: string, bg: string, fg: string) {
  return canvas(2048, 1024, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 2048, 1024);
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.font = '900 200px Outfit, sans-serif';
    c.fillText(text, 1024, 470);
    c.font = '600 90px Outfit, sans-serif';
    c.globalAlpha = 0.75;
    c.fillText(sub, 1024, 640);
    c.globalAlpha = 0.25;
    c.fillRect(160, 760, 1728, 6);
  });
}

export async function loadMaterials(r: THREE.WebGLRenderer, onProgress: (k: number) => void) {
  let done = 0;
  const step = <T,>(p: Promise<T>) => p.then((x) => (onProgress(++done / 5), x));
  const [velvetT, terryT, marbleT, metalT, cottonT] = await Promise.all([
    step(loadSet(r, 'velvet', 5)),
    step(loadSet(r, 'terry', 3)),
    step(loadSet(r, 'marble', 1.2)),
    step(loadSet(r, 'metal', 6)),
    step(loadSet(r, 'cotton', 2)),
  ]);

  const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
  const plastic = (color: number, rough = 0.35) => phys({ color, roughness: rough, clearcoat: 0.6, clearcoatRoughness: 0.15, roughnessMap: metalT.rough });

  const M = {
    velvet: phys({ map: velvetT.diff, normalMap: velvetT.nor, roughnessMap: velvetT.rough, color: 0x7a3f9a, sheen: 1, sheenColor: new THREE.Color(0xd08cff), sheenRoughness: 0.35 }),
    terry: phys({ map: terryT.diff, normalMap: terryT.nor, roughnessMap: terryT.rough, color: 0xfff2f6, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), normalScale: new THREE.Vector2(1.4, 1.4) }),
    marble: phys({ map: marbleT.diff, normalMap: marbleT.nor, roughnessMap: marbleT.rough, clearcoat: 0.5, clearcoatRoughness: 0.12 }),
    steel: phys({ color: 0xe6eaef, metalness: 1, roughness: 0.22, roughnessMap: metalT.rough, normalMap: metalT.nor, normalScale: new THREE.Vector2(0.15, 0.15) }),
    copper: phys({ color: 0xd08a4a, metalness: 1, roughness: 0.3, roughnessMap: metalT.rough }),
    anodized: phys({ color: 0x2c2f3d, metalness: 0.85, roughness: 0.32, roughnessMap: metalT.rough, normalMap: metalT.nor, normalScale: new THREE.Vector2(0.3, 0.3), clearcoat: 0.4 }),
    rubber: phys({ color: 0x18181d, roughness: 0.85, normalMap: cottonT.nor, normalScale: new THREE.Vector2(1.5, 1.5) }),
    whitePlastic: plastic(0xf4f4f6, 0.28),
    blackPlastic: plastic(0x141418, 0.3),
    amberGlass: phys({ color: 0xffb347, transmission: 0.92, thickness: 0.006, roughness: 0.05, ior: 1.5, attenuationColor: new THREE.Color(0xd77a10), attenuationDistance: 0.02 }),
    oil: phys({ color: 0xffbf4a, transmission: 0.7, thickness: 0.02, roughness: 0.02, ior: 1.47, attenuationColor: new THREE.Color(0xc06a00), attenuationDistance: 0.01 }),
    clearPlastic: phys({ color: 0xeaf6ff, transmission: 0.9, thickness: 0.002, roughness: 0.12, ior: 1.45 }),
    purplePlastic: plastic(0x8a4fd6, 0.25),
    brownPlastic: plastic(0x4a2a12, 0.3),
    greenTube: phys({ color: 0x2f9e66, metalness: 0.6, roughness: 0.3, roughnessMap: metalT.rough, clearcoat: 0.6 }),
    cotton: phys({ map: cottonT.diff, normalMap: cottonT.nor, roughnessMap: cottonT.rough, color: 0xffffff, sheen: 1, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.8 }),
    gauze: phys({ map: cottonT.diff, normalMap: cottonT.nor, color: 0xfbfbf4, roughness: 0.95, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) }),
    paper: phys({ color: 0xf6f1ff, roughness: 0.9, normalMap: cottonT.nor, normalScale: new THREE.Vector2(0.2, 0.2) }),
    ice: phys({ color: 0xbfe8ff, transmission: 0.85, thickness: 0.02, roughness: 0.15, ior: 1.31, clearcoat: 1 }),
    water: phys({ color: 0xffffff, transmission: 1, thickness: 0.003, roughness: 0.02, ior: 1.33 }),
    blood: phys({ color: 0x5a0007, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, transmission: 0.15, thickness: 0.003, attenuationColor: new THREE.Color(0x3a0004), attenuationDistance: 0.002 }),
    pus: phys({ color: 0xe0c060, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.4, sheenColor: new THREE.Color(0xfff2b0) }),
    film: phys({ color: 0xeef6ff, transmission: 0.95, thickness: 0.0005, roughness: 0.08, transparent: true, opacity: 0.8, side: THREE.DoubleSide, normalMap: cottonT.nor, normalScale: new THREE.Vector2(0.4, 0.4) }),
    glow: new THREE.MeshBasicMaterial({ color: 0x2ef2ff }),
    labelOil: phys({ map: label('ARGAN OIL', 'warm massage · 100 ml', '#f7efe2', '#8a4b10'), roughness: 0.5 }),
    labelShampoo: phys({ map: label('SILK', 'foot shampoo', '#efe4ff', '#5b2aa6'), roughness: 0.4, clearcoat: 0.5 }),
    labelPeroxide: phys({ map: label('H₂O₂ 3%', 'hydrogen peroxide', '#ffffff', '#1f5bc4'), roughness: 0.5 }),
    labelSaline: phys({ map: label('NaCl 0.9%', 'sterile saline', '#ffffff', '#0b7a4a'), roughness: 0.5 }),
    labelTube: phys({ map: label('HEAL+', 'antibiotic ointment', '#f2fff8', '#16784a'), roughness: 0.35, metalness: 0.3 }),

    /** Decal: inflamed laceration (2K, transparent). */
    cutDecal: new THREE.MeshPhysicalMaterial({
      map: canvas(2048, 1024, (c) => {
        const g = c.createRadialGradient(1024, 512, 0, 1024, 512, 900);
        g.addColorStop(0, 'rgba(170,30,40,0.75)');
        g.addColorStop(0.45, 'rgba(200,70,70,0.35)');
        g.addColorStop(1, 'rgba(200,80,80,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 2048, 1024);
        c.lineCap = 'round';
        const path = () => {
          c.beginPath();
          c.moveTo(380, 540);
          c.bezierCurveTo(760, 470, 1200, 600, 1680, 500);
        };
        c.filter = 'blur(10px)';
        c.strokeStyle = 'rgba(120,10,20,0.9)';
        c.lineWidth = 90;
        path();
        c.stroke();
        c.filter = 'none';
        c.strokeStyle = '#3a0308';
        c.lineWidth = 34;
        path();
        c.stroke();
        c.strokeStyle = 'rgba(255,160,150,0.55)';
        c.lineWidth = 8;
        path();
        c.stroke();
        // dried crust flecks
        for (let i = 0; i < 160; i++) {
          c.fillStyle = `rgba(${90 + Math.random() * 40},${20 + Math.random() * 20},10,${0.4 + Math.random() * 0.4})`;
          const t = Math.random();
          c.beginPath();
          c.arc(380 + t * 1300, 520 + Math.sin(t * 3) * 30 + (Math.random() - 0.5) * 60, 4 + Math.random() * 10, 0, Math.PI * 2);
          c.fill();
        }
      }),
      transparent: true,
      roughness: 0.25,
      clearcoat: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    }),

    /** Decal: adhesive bandage (2K). */
    bandageDecal: new THREE.MeshPhysicalMaterial({
      map: canvas(2048, 1024, (c) => {
        c.fillStyle = '#e6c29f';
        c.beginPath();
        c.roundRect(40, 160, 1968, 704, 300);
        c.fill();
        for (let i = 0; i < 2600; i++) {
          c.fillStyle = `rgba(150,110,80,${Math.random() * 0.35})`;
          c.fillRect(60 + Math.random() * 1930, 180 + Math.random() * 660, 5, 5);
        }
        c.fillStyle = '#fbfaf5';
        c.beginPath();
        c.roundRect(640, 230, 768, 564, 40);
        c.fill();
        c.strokeStyle = 'rgba(200,200,190,0.6)';
        c.lineWidth = 3;
        for (let x = 650; x < 1400; x += 22) {
          c.beginPath();
          c.moveTo(x, 240);
          c.lineTo(x, 785);
          c.stroke();
        }
      }),
      transparent: true,
      roughness: 0.75,
      sheen: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
    }),

    /** Toenail with nude-pink polish, lunula and a soft cuticle edge (decal). */
    nailDecal: new THREE.MeshPhysicalMaterial({
      map: canvas(512, 512, (c) => {
        c.translate(256, 256);
        const shape = () => {
          c.beginPath();
          c.moveTo(-170, 210);
          c.bezierCurveTo(-200, 40, -190, -170, 0, -200);
          c.bezierCurveTo(190, -170, 200, 40, 170, 210);
          c.closePath();
        };
        c.filter = 'blur(6px)';
        shape();
        c.fillStyle = 'rgba(232,170,155,0.9)';
        c.fill();
        c.filter = 'none';
        const g = c.createLinearGradient(0, -200, 0, 210);
        g.addColorStop(0, '#efbcae');
        g.addColorStop(0.7, '#e6a594');
        g.addColorStop(1, '#de9988');
        c.scale(0.9, 0.9);
        shape();
        c.fillStyle = g;
        c.fill();
        c.fillStyle = 'rgba(250,225,215,0.3)';
        c.beginPath();
        c.ellipse(0, 175, 95, 45, 0, Math.PI, 0);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.beginPath();
        c.ellipse(-60, -40, 28, 110, -0.15, 0, Math.PI * 2);
        c.fill();
      }),
      transparent: true,
      roughness: 0.35,
      clearcoat: 0.55,
      clearcoatRoughness: 0.15,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    }),

    /** Transfer paper with a faint printed grid. */
    feather: phys({
      map: canvas(1024, 2048, (c) => {
        c.translate(512, 2048);
        for (let i = 0; i < 260; i++) {
          const t = 0.12 + (i / 260) * 0.86;
          const y = -2048 * t;
          const len = Math.sin(t * Math.PI) * 420 + 40;
          for (const s of [-1, 1]) {
            c.strokeStyle = `hsla(${320 + t * 30},70%,${78 - t * 10}%,0.85)`;
            c.lineWidth = 5;
            c.beginPath();
            c.moveTo(0, y);
            c.quadraticCurveTo(s * len * 0.6, y - 60, s * len, y - 160);
            c.stroke();
          }
        }
        c.strokeStyle = '#efe6dc';
        c.lineWidth = 16;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -2000);
        c.stroke();
      }),
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      roughness: 0.7,
      sheen: 1,
      sheenColor: new THREE.Color(0xffe0f0),
    }),
  };
  return M;
}

export type Materials = Awaited<ReturnType<typeof loadMaterials>>;
