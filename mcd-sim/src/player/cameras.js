// Камеры: кабина, внешний вид (орбита), у пути, пешком (с выходом на платформу и входом в вагон).
import * as THREE from 'three';
import { input } from '../core/input.js';

export class CameraRig {
  constructor(camera, game) {
    this.cam = camera; this.game = game;
    this.mode = 'cab';
    this.cabYaw = 0; this.cabPitch = -0.05;
    this.orbit = { yaw: 2.6, pitch: 0.18, dist: 28, car: 0 };
    this.trackside = null;
    // пешком: координаты линии (s, lat, h) или внутри поезда (dsTrain, latTrain)
    this.walk = { s: 0, lat: 0, h: 1.1, yaw: 0, pitch: 0, vy: 0, inTrain: false, ds: 0, dl: 0 };
    this.tmp = new THREE.Vector3();
  }

  setMode(m) {
    const g = this.game;
    if (m === this.mode) return;
    if (m === 'walk' && this.mode === 'cab') {
      // встаём с кресла: позиция в кабине
      this.walk.inTrain = true;
      this.walk.ds = 3.2; this.walk.dl = 0; this.walk.h = g.sim.spec.floorHeight;
      this.walk.yaw = this.cabYaw; this.walk.pitch = 0;
    } else if (m === 'walk' && !this.walk.inTrain && this.mode !== 'walk') {
      // из внешних камер — рядом с поездом на платформе/земле
      const sim = g.sim;
      this.walk.inTrain = true; this.walk.ds = 6; this.walk.dl = 0; this.walk.h = sim.spec.floorHeight;
    }
    if (m === 'trackside') this.trackside = null;
    this.mode = m;
    g.audio.setInside(m === 'cab' || (m === 'walk' && this.walk.inTrain));
  }

  cycle() {
    const order = ['cab', 'exterior', 'trackside', 'walk'];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
  }

  update(dt) {
    const g = this.game, sim = g.sim, route = g.route;
    const look = input.lookDelta(dt);
    if (input.pressed('lookReset')) { this.cabYaw = 0; this.cabPitch = -0.05; }
    const front = g.model.cars[0];
    if (this.mode === 'cab') {
      this.cabYaw = THREE.MathUtils.clamp(this.cabYaw - look.x, -2.6, 2.6);
      this.cabPitch = THREE.MathUtils.clamp(this.cabPitch - look.y, -1.1, 0.9);
      front.updateMatrixWorld();
      const cabGroup = g.cab.group;
      cabGroup.updateMatrixWorld();
      this.cam.position.copy(g.cab.eye).applyMatrix4(cabGroup.matrixWorld);
      // лёгкое покачивание
      const sway = Math.sin(performance.now() / 700) * 0.004 * Math.min(1, sim.speedKmh / 60);
      this.cam.position.y += sway;
      const q = new THREE.Quaternion().setFromRotationMatrix(cabGroup.matrixWorld);
      const e = new THREE.Euler(this.cabPitch, this.cabYaw, 0, 'YXZ');
      this.cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(e));
    } else if (this.mode === 'exterior') {
      const o = this.orbit;
      o.yaw -= look.x * 1.2; o.pitch = THREE.MathUtils.clamp(o.pitch + look.y, -0.05, 1.3);
      if (input.mouse.wheel) o.dist = THREE.MathUtils.clamp(o.dist * (1 + input.mouse.wheel * 0.1), 7, 160);
      if (input.pad) { if (input.padButtons[4] > 0.5) o.dist = Math.max(7, o.dist - dt * 20); }
      const car = g.model.cars[Math.min(o.car, g.model.cars.length - 1)];
      const target = car.getWorldPosition(this.tmp).clone(); target.y += 2.6;
      const carYaw = car.rotation.y;
      const a = carYaw + o.yaw;
      this.cam.position.set(target.x + Math.sin(a) * Math.cos(o.pitch) * o.dist, target.y + Math.sin(o.pitch) * o.dist, target.z + Math.cos(a) * Math.cos(o.pitch) * o.dist);
      const gy = route.elevation(sim.s) - 0.6;
      if (this.cam.position.y < gy + 0.6) this.cam.position.y = gy + 0.6;
      this.cam.lookAt(target);
    } else if (this.mode === 'trackside') {
      const dir = sim.dir * (sim.reverser < 0 ? -1 : 1);
      if (!this.trackside || (this.trackside.s - sim.s) * dir < -120) {
        const s = sim.s + dir * (220 + Math.random() * 120);
        const side = Math.random() < 0.5 ? -1 : 1;
        const lat = route.trackOffset(s, side) + side * (6 + Math.random() * 6);
        this.trackside = { s, pos: new THREE.Vector3().copy(route.point(s, lat, 1.6)) };
      }
      this.cam.position.copy(this.trackside.pos);
      const target = front.getWorldPosition(this.tmp).clone(); target.y += 2.2;
      this.cam.lookAt(target);
    } else if (this.mode === 'walk') {
      this.updateWalk(dt, look);
    }
  }

  updateWalk(dt, look) {
    const g = this.game, sim = g.sim, route = g.route, W = this.walk;
    W.yaw -= look.x; W.pitch = THREE.MathUtils.clamp(W.pitch - look.y, -1.4, 1.4);
    const mv = input.moveAxes();
    const speed = (input.down('run') ? 4.2 : 1.6) * dt;
    const dir = sim.dir;
    const trackLat = (s) => g.trackLat(s);
    if (W.inTrain) {
      // координаты внутри поезда: ds — от головы назад, dl — поперёк (+ вправо по ходу)
      // в системе поезда: yaw=0 — смотрим вперёд по ходу, + — влево
      const dF = mv.y * Math.cos(W.yaw) + mv.x * Math.sin(W.yaw);
      const dR = -mv.y * Math.sin(W.yaw) + mv.x * Math.cos(W.yaw);
      let ds = W.ds - dF * speed, dl = W.dl + dR * speed;
      ds = THREE.MathUtils.clamp(ds, 2.6, sim.length - 2.6);
      const halfW = sim.spec.carWidth / 2 - 0.35;
      // выход через открытую дверь
      const doorAt = g.doorAt(ds, dl > 0 ? 'right' : 'left');
      if (Math.abs(dl) > halfW) {
        if (doorAt && Math.abs(dl) > halfW + 0.3) {
          // вышли из вагона
          const s = sim.s - dir * ds;
          W.inTrain = false; W.s = s; W.lat = trackLat(s) + dir * dl; W.h = sim.spec.floorHeight;
          W.yaw = W.yaw + (dir > 0 ? 0 : Math.PI);
          g.audio.setInside(false);
        } else if (!doorAt) dl = Math.sign(dl) * halfW;
      }
      if (W.inTrain) {
        W.ds = ds; W.dl = dl;
        const s = sim.s - dir * ds;
        const p = route.point(s, trackLat(s) + dir * dl, sim.spec.floorHeight + 1.62);
        this.cam.position.set(p.x, p.y, p.z);
        const hd = route.heading(s) + (dir > 0 ? 0 : Math.PI);
        this.cam.quaternion.setFromEuler(new THREE.Euler(W.pitch, -hd + W.yaw, 0, 'YXZ'));
        // сесть в кресло
        g.prompt = ds < 4.5 ? `${input.bindingLabel('interact')} — сесть в кресло машиниста` : '';
        if (ds < 4.5 && input.pressed('interact')) { this.setMode('cab'); }
        return;
      }
    }
    // на платформе / земле: координаты линии
    const hd = route.heading(W.s);
    const camYaw = -hd + W.yaw;
    const ds = (mv.y * Math.cos(W.yaw) + mv.x * Math.sin(W.yaw)) * speed;
    const dl = (-mv.y * Math.sin(W.yaw) + mv.x * Math.cos(W.yaw)) * speed;
    let ns = W.s + ds, nl = W.lat + dl;
    // столкновение с поездом и вход в вагон
    const inFoot = (s, lat) => {
      const a = Math.min(sim.s, sim.rearS), b = Math.max(sim.s, sim.rearS);
      return s > a && s < b && Math.abs(lat - trackLat(s)) < sim.spec.carWidth / 2 + 0.05;
    };
    if (inFoot(ns, nl)) {
      const dsT = (sim.s - ns) * dir;
      const side = (nl - trackLat(ns)) * dir > 0 ? 'right' : 'left';
      if (g.doorAt(dsT, side) && Math.abs(W.h - sim.spec.floorHeight) < 0.5) {
        W.inTrain = true; W.ds = dsT; W.dl = (nl - trackLat(ns)) * dir;
        W.yaw -= dir > 0 ? 0 : Math.PI;
        g.audio.setInside(true);
        return;
      }
      ns = W.s; nl = W.lat;
    }
    const gh = g.world.walkHeight(ns, nl, W.h);
    if (gh > W.h + 0.45) { ns = W.s; nl = W.lat; }
    W.s = ns; W.lat = nl;
    const groundH = g.world.walkHeight(W.s, W.lat, W.h);
    if (W.h > groundH + 0.02) { W.vy -= 9.8 * dt; W.h = Math.max(groundH, W.h + W.vy * dt); }
    else { W.h = groundH; W.vy = 0; }
    const p = route.point(W.s, W.lat, W.h + 1.65);
    this.cam.position.set(p.x, p.y, p.z);
    this.cam.quaternion.setFromEuler(new THREE.Euler(W.pitch, camYaw, 0, 'YXZ'));
    // подсказка у двери
    const nearDoor = g.doorAt((sim.s - W.s) * dir, (W.lat - trackLat(W.s)) * dir > 0 ? 'right' : 'left', 2.0);
    g.prompt = nearDoor ? 'Войдите в открытую дверь, чтобы зайти в вагон' : (W.h < 0 && Math.abs(W.lat - trackLat(W.s)) < 2 ? 'Осторожно: вы на путях!' : '');
  }
}
