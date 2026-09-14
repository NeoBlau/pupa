import { buildGraph, graphStats, F, classifyWay, parseMaxspeed } from '../js/routing/graph.js';
import { route, snap, summarise } from '../js/routing/router.js';
import { lineLength, flatDistance } from '../js/lib/geo.js';

// --- synthetic Manhattan grid around Moscow: N x N blocks, ~200 m spacing
const N = 15, step = 0.002; // ~222m lat, ~128m lon
const lon0 = 37.60, lat0 = 55.74;
const nodes = new Map(); const ways = [];
const nid = (i,j) => i*1000 + j + 1;
for (let i=0;i<N;i++) for (let j=0;j<N;j++) nodes.set(nid(i,j), [lon0+j*step, lat0+i*step]);
let wid = 1;
for (let i=0;i<N;i++) ways.push({id:wid++, nodes:Array.from({length:N},(_,j)=>nid(i,j)), tags:{highway:'residential', name:`Улица ${i}`, maxspeed:'40'}});
for (let j=0;j<N;j++) ways.push({id:wid++, nodes:Array.from({length:N},(_,i)=>nid(i,j)), tags:{highway:'secondary', name:`Проспект ${j}`, maxspeed:'60'}});

const g = buildGraph({nodes, ways});
console.log('stats', graphStats(g));

const A = [lon0+0.0005, lat0+0.0005], B = [lon0+(N-1)*step-0.0005, lat0+(N-1)*step-0.0005];
const straight = flatDistance(A,B);
const r = route(g, A, B, {profile:'car'});
console.log('route dist', r.distance.toFixed(0), 'm | straight', straight.toFixed(0), 'm | ratio', (r.distance/straight).toFixed(2));
console.log('duration', (r.duration/60).toFixed(1), 'min | avg kmh', (r.distance/1000/(r.duration/3600)).toFixed(1));
console.log('coords', r.coordinates.length, 'geomLen', lineLength(r.coordinates).toFixed(0), 'expanded', r.expanded);
console.log('summary', summarise(g, r));

// Manhattan distance lower bound check
const manhattan = Math.abs(B[0]-A[0])*Math.cos(lat0*Math.PI/180)*111320 + Math.abs(B[1]-A[1])*110574;
console.log('manhattan bound', manhattan.toFixed(0), '=> within 5%:', Math.abs(r.distance-manhattan)/manhattan < 0.05);

// --- oneway test: make row 7 one-way eastbound, route westbound along it
const ways2 = ways.map(w => w.tags.name === 'Улица 7' ? {...w, tags:{...w.tags, oneway:'yes'}} : w);
const g2 = buildGraph({nodes, ways:ways2});
const P = [lon0+2*step, lat0+7*step], Q = [lon0+10*step, lat0+7*step];
const east = route(g2,P,Q,{profile:'car'}), west = route(g2,Q,P,{profile:'car'});
console.log('oneway east dist', east.distance.toFixed(0), '| west detour dist', west.distance.toFixed(0), '| detour longer:', west.distance > east.distance*1.2);

// --- profiles + preference
for (const profile of ['car','bike','foot','hike']) {
  const rr = route(g, A, B, {profile});
  console.log(profile.padEnd(5), (rr.distance/1000).toFixed(2),'km', (rr.duration/60).toFixed(1),'min');
}

// --- avoid: toll only the middle column (7); a detour must exist and skip it
const ways3 = ways.map(w => w.tags.name==='Проспект 7' ? {...w, tags:{...w.tags, toll:'yes', maxspeed:'90'}} : w);
const g3 = buildGraph({nodes, ways:ways3});
const P3=[lon0+7*step, lat0+1*step], Q3=[lon0+7*step, lat0+13*step];
const withToll = route(g3, P3, Q3, {profile:'car'});
const noToll   = route(g3, P3, Q3, {profile:'car', avoid:{tolls:true}});
console.log('toll route uses toll:', summarise(g3,withToll).toll.toFixed(0), 'm | avoid-tolls uses:', summarise(g3,noToll).toll.toFixed(0), 'm | detour longer:', noToll.distance > withToll.distance);
console.log('blocked-everything returns null:', route(g3,P3,Q3,{profile:'car',avoid:{tolls:true,unpaved:true,ferries:true}}) !== null);

// --- scenic preference must actually pick the scenic road
// Same speed limit as its neighbours, so only the scenic weighting can move the route.
const ways4 = ways.map(w => w.tags.name==='Проспект 3' ? {...w, tags:{...w.tags, scenic:'yes', maxspeed:'60'}} : w);
const g4 = buildGraph({nodes, ways:ways4});
const P4=[lon0+1*step, lat0+1*step], Q4=[lon0+6*step, lat0+13*step];
const fast4   = route(g4,P4,Q4,{profile:'car',preference:'fastest'});
const scenic4 = route(g4,P4,Q4,{profile:'car',preference:'scenic'});
const fastScenicM = summarise(g4,fast4).scenic, prefScenicM = summarise(g4,scenic4).scenic;
console.log('fastest uses', fastScenicM.toFixed(0), 'm of scenic road |',
            'scenic preference uses', prefScenicM.toFixed(0), 'm |',
            'prefers scenery:', prefScenicM > fastScenicM,
            '| costs', ((scenic4.duration-fast4.duration)/60).toFixed(1), 'min more');
if (!(prefScenicM > fastScenicM)) { console.error('FAIL: scenic preference did not pick the scenic road'); process.exitCode = 1; }

// --- tag parsing
console.log('maxspeed RU:urban', parseMaxspeed('RU:urban'), '| 50 mph', parseMaxspeed('50 mph'), '| none', parseMaxspeed('none'));
const mw = classifyWay({highway:'motorway', oneway:'yes', toll:'yes'});
console.log('motorway flags car fwd', !!(mw.flags & F.CAR_FWD), 'bwd', !!(mw.flags & F.CAR_BWD), 'foot', !!(mw.flags & F.FOOT), 'toll', !!(mw.flags & F.TOLL));
const pathw = classifyWay({highway:'path', sac_scale:'mountain_hiking'});
console.log('path foot', !!(pathw.flags & F.FOOT), 'trail', !!(pathw.flags & F.TRAIL), 'unpaved', !!(pathw.flags & F.UNPAVED), 'car', !!(pathw.flags & F.CAR_FWD));

// --- perf
const t0 = performance.now();
for (let k=0;k<30;k++) route(g, A, B, {profile:'car'});
console.log('30 routes in', (performance.now()-t0).toFixed(0), 'ms');
