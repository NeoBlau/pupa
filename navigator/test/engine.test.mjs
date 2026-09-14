import { NavEngine } from '../js/nav/engine.js';
import { destination, lineLength, flatDistance } from '../js/lib/geo.js';

// straight 2 km north, then 1 km east
const start=[37.6173,55.7558];
const line=[start];
for (let d=100; d<=2000; d+=100) line.push(destination(start,d,0));
const corner=line[line.length-1];
for (let d=100; d<=1000; d+=100) line.push(destination(corner,d,90));
const total=lineLength(line);
const steps=[
 {type:'depart',modifier:'straight',name:'Север',alongStart:0,distance:2000,remaining:total,index:0},
 {type:'turn',modifier:'right',name:'Восток',alongStart:2000,distance:1000,remaining:1000,index:1},
 {type:'arrive',modifier:'straight',name:'',alongStart:total,distance:0,remaining:0,index:2},
];
const e=new NavEngine();
const events=[]; e.on('off-route',()=>events.push('off')); e.on('arrived',()=>events.push('arr')); e.on('step',s=>events.push('step'+s.index));
e.start({coordinates:line,distance:total,duration:total/(60/3.6),steps});

console.log('total route', total.toFixed(0),'m');
let t=Date.now();
const drive=(coords,speed,heading)=>e.update({coords,accuracy:8,speed,heading,at:(t+=1000)});

let p=drive(line[0],0,0);
console.log('at start: remaining',p.remaining.toFixed(0),'step',p.step.name,'toManeuver',p.distanceToManeuver.toFixed(0));
for (let d=100; d<=1900; d+=100) p=drive(destination(start,d,0),16.6,0);
console.log('after 1.9km: along',p.along.toFixed(0),'remaining',p.remaining.toFixed(0),'toManeuver',p.distanceToManeuver.toFixed(0),'step',p.step.name);
p=drive(destination(start,2000,0),16.6,0);
p=drive(destination(corner,60,90),16.6,90);
console.log('past corner: along',p.along.toFixed(0),'step now', p.step.name, '| toManeuver', p.distanceToManeuver.toFixed(0), '| events', events.join(','));
p=drive(destination(corner,500,90),16.6,90);
console.log('mid east leg: step', p.step.name, 'remaining', p.remaining.toFixed(0));
// snapping: 20 m off the line should NOT be off-route
p=drive(destination(destination(start,1000,0),20,90),16.6,0);
console.log('20m off line -> deviation',p.deviation.toFixed(0),'offRoute',p.offRoute);
// 120 m off for 3 fixes SHOULD be off-route
for (let i=0;i<3;i++) p=drive(destination(destination(start,1000,0),120,90),16.6,90);
console.log('120m off x3 -> offRoute event fired:', events.includes('off'));
// arrival
const e2=new NavEngine(); const ev2=[]; e2.on('arrived',()=>ev2.push('arr'));
e2.start({coordinates:line,distance:total,duration:180,steps});
let t2=Date.now();
for (const c of line) e2.update({coords:c,accuracy:5,speed:16,heading:0,at:(t2+=1000)});
const last=e2.update({coords:line[line.length-1],accuracy:5,speed:0,heading:90,at:(t2+=1000)});
console.log('arrival fired:', ev2.length===1, '| remaining', last.remaining.toFixed(1),'| fraction',last.fraction.toFixed(3));
// ETA sanity: 60 km/h on 3 km remaining ~ 3 min
const e3=new NavEngine(); e3.start({coordinates:line,distance:total,duration:total/(60/3.6),steps});
let t3=Date.now(); let pp;
for (let i=0;i<4;i++) pp=e3.update({coords:destination(start,i*16.6,0),accuracy:5,speed:16.6,heading:0,at:(t3+=1000)});
console.log('ETA at 60km/h:', (pp.duration/60).toFixed(1),'min for', (pp.remaining/1000).toFixed(2),'km | speed', (pp.speed*3.6).toFixed(0),'km/h');
// heading smoothing across 359->1
const e4=new NavEngine(); e4.start({coordinates:line,distance:total,duration:200,steps});
let t4=Date.now(); let h;
for (const hh of [359,1,3,2]) h=e4.update({coords:destination(start,100,0),accuracy:5,speed:10,heading:hh,at:(t4+=1000)});
console.log('heading smoothing 359->1->3->2 gives', h.heading.toFixed(1), '(must be near 0, not 180)');
