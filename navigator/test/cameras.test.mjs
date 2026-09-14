import { CameraRadar, speedingBy } from '../js/features/cameras.js';
import { destination } from '../js/lib/geo.js';

const here = [37.6173, 55.7558];
const r = new CameraRadar();
const cam = (id, dist, brng, extra={}) => ({ id, coords: destination(here, dist, brng), kind:'speed', maxspeed:60, direction:null, ...extra });

r.add([
  cam('ahead-400', 400, 0),
  cam('behind-200', 200, 180),
  cam('side-300', 300, 90),
  cam('ahead-far-2km', 2000, 0),
]);

const alerts = []; r.on('alert', a => alerts.push(`${a.camera.id}/${a.stage}`));
const at = (speedKmh) => r.evaluate({ coords: here, heading: 0, speed: speedKmh/3.6 });

console.log('--- selection ---');
const res = at(60);
console.log('picked:', res?.camera.id, '| dist', res?.distance.toFixed(0), '| eta', res?.eta.toFixed(1),'s | stage', res?.stage);
console.log('ignores behind/side/far:', res?.camera.id === 'ahead-400');

console.log('--- time-based staging: same camera, different speeds ---');
for (const v of [30, 40, 60, 90, 130]) {
  const rr = new CameraRadar(); rr.add([cam('c', 400, 0)]);
  const out = rr.evaluate({coords:here, heading:0, speed:v/3.6});
  console.log(`  ${String(v).padStart(3)} km/h, camera 400 m ahead -> eta ${out.eta.toFixed(1)}s -> stage ${out.stage}`);
}
for (const d of [1100, 700, 400, 200, 90, 40]) {
  const rr = new CameraRadar(); rr.add([cam('c', d, 0)]);
  const out = rr.evaluate({coords:here, heading:0, speed:90/3.6});
  console.log(`  90 km/h, camera ${String(d).padStart(4)} m ahead -> stage ${out?.stage ?? 'none'}`);
}

console.log('--- direction cone ---');
const r2 = new CameraRadar();
r2.add([cam('lens-facing-us', 300, 0, {lensDirection: 180}), cam('lens-facing-away', 310, 0, {lensDirection: 0})]);
const dirRes = r2.evaluate({coords:here, heading:0, speed:16});
console.log('lens tag -> picks camera pointed at us:', dirRes?.camera.id);
const r2b = new CameraRadar();
r2b.add([cam('traffic-ours', 300, 0, {direction: 0}), cam('traffic-oncoming', 310, 0, {direction: 180})]);
console.log('traffic tag -> picks our direction:', r2b.evaluate({coords:here, heading:0, speed:16})?.camera.id);

console.log('--- no-repeat within 2 min ---');
alerts.length = 0;
const r3 = new CameraRadar(); r3.add([cam('x', 350, 0)]);
for (let i=0;i<5;i++) r3.evaluate({coords:here, heading:0, speed:16});
const a3=[]; r3.on('alert',a=>a3.push(a.stage));
for (let i=0;i<5;i++) r3.evaluate({coords:here, heading:0, speed:16});
console.log('repeat alerts suppressed:', a3.length === 0);

console.log('--- type filtering ---');
const r4 = new CameraRadar(); r4.configure({types:{speed:false, redLight:true, average:true, bus:true, parking:false, mobile:true}});
r4.add([cam('speed-cam',300,0,{kind:'speed'}), cam('red-cam',350,0,{kind:'redLight'})]);
console.log('speed cameras off -> picks:', r4.evaluate({coords:here,heading:0,speed:16})?.camera.id);

console.log('--- average-speed zone ---');
const r5 = new CameraRadar();
const entry = { id:'e', coords: destination(here, 20, 0), kind:'average', maxspeed:90, direction:null };
const exitC = { id:'x', coords: destination(here, 10000, 0), kind:'average', maxspeed:90, direction:null };
r5.add([entry, exitC]);
const events=[]; r5.on('zone-start',()=>events.push('start')); r5.on('zone-end',()=>events.push('end'));
r5.evaluate({coords: here, heading:0, speed:27});
console.log('zone started:', events.includes('start'), '| exit camera found:', r5.zone?.exitCamera?.id);
// simulate driving 10 km in 5 minutes = 120 km/h average, limit 90
const started = r5.zone.startedAt;
r5.zone.startedAt = Date.now() - 300*1000;
r5.evaluate({coords: destination(here, 10000, 0), heading:0, speed:33});
console.log('zone ended at exit camera:', events.includes('end'));
const r6 = new CameraRadar(); r6.add([entry, {...exitC, coords: destination(here,20000,0)}]);
r6.evaluate({coords:here, heading:0, speed:27});
r6.zone.startedAt = Date.now() - 300*1000;
r6.evaluate({coords: destination(here, 10000, 0), heading:0, speed:33});
console.log('running average km/h:', r6.zone?.average.toFixed(0), '| over limit flagged:', r6.zone?.projectedFine);

console.log('--- speeding ---');
console.log('110 km/h in a 90:', speedingBy(110/3.6, 90), '| 88 in a 90:', speedingBy(88/3.6, 90), '| no limit:', speedingBy(30, null));
