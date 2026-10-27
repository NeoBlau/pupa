// 3D tool models. Convention: the working tip is at the origin and the tool body extends
// along +Y (away from the skin). Sizes in metres, close to real instruments.

import * as THREE from 'three';
import type { Materials } from './materials.ts';
import type { Textures } from './textures.ts';
import { roundedSlab } from './geom.ts';

export type ToolName =
  | 'bottle'
  | 'shampoo'
  | 'peroxide'
  | 'saline'
  | 'tube'
  | 'shower'
  | 'machine'
  | 'laser'
  | 'needle'
  | 'swab'
  | 'feather'
  | 'cotton'
  | 'gauze'
  | 'towel'
  | 'ice'
  | 'paper';

const V = (x: number, y: number) => new THREE.Vector2(x, y);

function lathe(profile: [number, number][], mat: THREE.Material, seg = 48) {
  return new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => V(r, y)), seg), mat);
}

function band(r: number, y0: number, y1: number, mat: THREE.Material, arc = Math.PI * 1.4) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 64, 1, true, -arc / 2 + Math.PI, arc), mat);
  m.position.y = (y0 + y1) / 2;
  return m;
}

function helix(r: number, y0: number, y1: number, turns: number, tube: number, mat: THREE.Material) {
  const pts: THREE.Vector3[] = [];
  const n = turns * 24;
  for (let i = 0; i <= n; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + ((y1 - y0) * i) / n, Math.sin(a) * r));
  }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, tube, 6, false), mat);
}

function cable(from: THREE.Vector3, mat: THREE.Material) {
  const pts = [from, from.clone().add(new THREE.Vector3(0.01, 0.05, 0.01)), from.clone().add(new THREE.Vector3(0.05, 0.12, -0.02)), from.clone().add(new THREE.Vector3(0.14, 0.18, -0.08))];
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0022, 10), mat);
}

/** Bumpy blob (cotton ball). */
function fluff(r: number, mat: THREE.Material) {
  const g = new THREE.IcosahedronGeometry(r, 5);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 900) * Math.sin(v.y * 700) * Math.sin(v.z * 800) * 0.12 + Math.sin(v.x * 2300 + v.z * 1900) * 0.04;
    v.multiplyScalar(1 + n);
    v.y *= 0.8;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.position.y = r * 0.75;
  return m;
}

export function createTool(name: ToolName, M: Materials, _T: Textures): THREE.Object3D {
  const g = new THREE.Group();
  switch (name) {
    case 'needle': {
      // 0.3 × 40 mm acupuncture needle with copper spiral handle.
      g.add(lathe([[0, 0], [0.00012, 0.0004], [0.00017, 0.002], [0.00017, 0.03], [0, 0.0301]], M.steel, 12));
      g.add(lathe([[0, 0.03], [0.0008, 0.03], [0.0008, 0.055], [0, 0.055]], M.copper, 16));
      g.add(helix(0.00085, 0.0302, 0.0548, 34, 0.00028, M.copper));
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.0014, 0.00028, 8, 24), M.copper);
      loop.position.y = 0.0565;
      g.add(loop);
      break;
    }
    case 'machine': {
      // Rotary pen machine: cartridge, rubber grip, anodized body, cable.
      g.add(lathe([[0, -0.0008], [0.00022, 0], [0.0003, 0.004]], M.steel, 12));
      g.add(lathe([[0.0012, 0.003], [0.0035, 0.006], [0.0055, 0.022], [0.0062, 0.026], [0, 0.026]], M.clearPlastic));
      g.add(lathe([[0.0062, 0.026], [0.0078, 0.03], [0.0076, 0.07], [0.0085, 0.074], [0, 0.074]], M.rubber));
      g.add(lathe([[0.0085, 0.074], [0.0095, 0.08], [0.0095, 0.14], [0.0075, 0.148], [0.003, 0.15], [0, 0.15]], M.anodized));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0096, 0.0006, 8, 48), M.glow);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.1;
      g.add(ring, cable(new THREE.Vector3(0, 0.15, 0), M.blackPlastic));
      break;
    }
    case 'laser': {
      g.add(lathe([[0.0035, 0], [0.006, 0.004], [0.009, 0.02], [0.012, 0.024], [0, 0.024]], M.blackPlastic));
      g.add(lathe([[0.012, 0.024], [0.0135, 0.03], [0.0135, 0.15], [0.01, 0.16], [0, 0.16]], M.whitePlastic));
      for (const y of [0.05, 0.056]) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.0136, 0.0007, 8, 48), M.glow);
        r.rotation.x = Math.PI / 2;
        r.position.y = y;
        g.add(r);
      }
      g.add(cable(new THREE.Vector3(0, 0.16, 0), M.blackPlastic));
      break;
    }
    case 'bottle': {
      // Amber glass dropper-bottle of massage oil, nozzle down.
      g.add(lathe([[0, 0], [0.0012, 0.0005], [0.0022, 0.008], [0.0045, 0.012], [0, 0.012]], M.whitePlastic));
      g.add(lathe([[0.0065, 0.012], [0.0068, 0.024], [0, 0.024]], M.blackPlastic));
      g.add(lathe([[0.006, 0.024], [0.008, 0.03], [0.017, 0.04], [0.019, 0.05], [0.019, 0.11], [0.017, 0.114], [0, 0.114]], M.amberGlass));
      g.add(lathe([[0.016, 0.042], [0.017, 0.05], [0.017, 0.085], [0, 0.085]], M.oil));
      g.add(band(0.0192, 0.06, 0.1, M.labelOil));
      break;
    }
    case 'shampoo': {
      const body = lathe([[0, 0], [0.002, 0.001], [0.003, 0.006], [0.009, 0.01], [0.009, 0.02], [0.012, 0.024], [0.022, 0.035], [0.024, 0.12], [0.02, 0.128], [0, 0.128]], M.purplePlastic);
      body.scale.z = 0.6;
      const lab = band(0.0242, 0.05, 0.105, M.labelShampoo, Math.PI * 0.9);
      lab.scale.z = 0.6;
      g.add(body, lab);
      break;
    }
    case 'peroxide': {
      g.add(lathe([[0, 0], [0.0015, 0.0005], [0.0025, 0.012], [0.006, 0.016], [0, 0.016]], M.whitePlastic));
      g.add(lathe([[0.007, 0.016], [0.0075, 0.026], [0, 0.026]], M.whitePlastic));
      g.add(lathe([[0.007, 0.026], [0.01, 0.034], [0.019, 0.045], [0.02, 0.12], [0.018, 0.124], [0, 0.124]], M.brownPlastic));
      g.add(band(0.0202, 0.06, 0.105, M.labelPeroxide));
      break;
    }
    case 'saline': {
      g.add(lathe([[0, 0], [0.0012, 0.0005], [0.0018, 0.025], [0.005, 0.03], [0, 0.03]], M.clearPlastic));
      g.add(lathe([[0.006, 0.03], [0.012, 0.038], [0.016, 0.05], [0.017, 0.12], [0, 0.12]], M.clearPlastic));
      g.add(lathe([[0.015, 0.052], [0.0155, 0.09], [0, 0.09]], M.water));
      g.add(band(0.0172, 0.07, 0.11, M.labelSaline));
      break;
    }
    case 'tube': {
      g.add(lathe([[0, 0], [0.0015, 0.0005], [0.0022, 0.008], [0.004, 0.012], [0, 0.012]], M.whitePlastic));
      const body = lathe([[0.006, 0.012], [0.011, 0.02], [0.012, 0.09], [0, 0.09]], M.greenTube);
      // flatten toward the crimped end
      const p = body.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = Math.max(0, (p.getY(i) - 0.02) / 0.07);
        p.setX(i, p.getX(i) * (1 + t * 0.35));
        p.setZ(i, p.getZ(i) * (1 - t * 0.85));
      }
      body.geometry.computeVertexNormals();
      g.add(body, band(0.0122, 0.03, 0.07, M.labelTube, Math.PI * 0.7));
      break;
    }
    case 'shower': {
      const head = lathe([[0, 0], [0.028, 0], [0.03, 0.002], [0.031, 0.01], [0.012, 0.018], [0, 0.018]], M.steel, 64);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0275, 64), M.blackPlastic);
      face.rotation.x = Math.PI / 2;
      face.position.y = 0.0005;
      for (let i = 0; i < 60; i++) {
        const a = i * 2.4;
        const r = Math.sqrt(i / 60) * 0.024;
        const n = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.001, 8), M.whitePlastic);
        n.position.set(Math.cos(a) * r, -0.0002, Math.sin(a) * r);
        g.add(n);
      }
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.16, 32), M.steel);
      handle.position.set(0.05, 0.07, 0);
      handle.rotation.z = -0.7;
      g.add(head, face, handle);
      break;
    }
    case 'swab': {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.075, 12), M.paper);
      stick.position.y = 0.045;
      const tip = fluff(0.004, M.cotton);
      tip.scale.y = 2.2;
      tip.position.y = 0.006;
      g.add(stick, tip);
      break;
    }
    case 'feather': {
      const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.1, 1, 8), M.feather);
      vane.position.y = 0.05;
      // gentle curl
      const p = vane.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getY(i) / 0.1 + 0.5) * Math.PI) * 0.006);
      vane.geometry.computeVertexNormals();
      g.add(vane);
      break;
    }
    case 'cotton':
      g.add(fluff(0.013, M.cotton));
      break;
    case 'gauze': {
      const pad = new THREE.Mesh(roundedSlab(0.045, 0.045, 0.004, 0.003), M.gauze);
      pad.rotation.x = -Math.PI / 2;
      g.add(pad);
      break;
    }
    case 'towel': {
      const t = new THREE.Mesh(roundedSlab(0.08, 0.05, 0.018, 0.008), M.terry);
      t.rotation.x = -Math.PI / 2;
      g.add(t);
      break;
    }
    case 'ice': {
      const t = new THREE.Mesh(roundedSlab(0.07, 0.05, 0.018, 0.009), M.ice);
      t.rotation.x = -Math.PI / 2;
      g.add(t);
      break;
    }
    case 'paper': {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.055), M.paper);
      t.rotation.x = -Math.PI / 2;
      t.position.y = 0.0006;
      g.add(t);
      break;
    }
  }
  return g;
}
