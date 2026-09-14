/* maneuvers.js — turn-by-turn steps, generated from an offline graph route or
   adapted from OSRM steps, so the navigation engine sees one shape either way. */

import { bearing, bearingDelta, cumulative, flatDistance } from '../lib/geo.js';
import { F, edgeGeometry, edgeNameOf } from './graph.js';

/** Classify a bearing change into a turn modifier. */
export function modifierFor(delta) {
  const a = Math.abs(delta);
  if (a >= 160) return 'uturn';
  if (a < 12) return 'straight';
  const side = delta < 0 ? 'left' : 'right';
  if (a < 40) return `slight ${side}`;
  if (a < 115) return side;
  return `sharp ${side}`;
}

const PHRASE = {
  ru: {
    depart: 'Начните движение', arrive: 'Вы прибыли', arriveLeft: 'Пункт назначения слева',
    arriveRight: 'Пункт назначения справа',
    straight: 'Продолжайте прямо',
    'slight left': 'Плавно налево', left: 'Поверните налево', 'sharp left': 'Резко налево',
    'slight right': 'Плавно направо', right: 'Поверните направо', 'sharp right': 'Резко направо',
    uturn: 'Развернитесь',
    roundabout: (exit) => `На кольце — ${exit}-й съезд`,
    merge: 'Перестройтесь', fork: 'Держитесь', exitLeft: 'Съезд налево', exitRight: 'Съезд направо',
    onto: 'на', keep: 'Держитесь', then: 'затем',
    inDistance: (d) => `Через ${d}`, now: 'Сейчас',
  },
  en: {
    depart: 'Start driving', arrive: 'You have arrived', arriveLeft: 'Destination on the left',
    arriveRight: 'Destination on the right',
    straight: 'Continue straight',
    'slight left': 'Bear left', left: 'Turn left', 'sharp left': 'Sharp left',
    'slight right': 'Bear right', right: 'Turn right', 'sharp right': 'Sharp right',
    uturn: 'Make a U-turn',
    roundabout: (exit) => `At the roundabout take exit ${exit}`,
    merge: 'Merge', fork: 'Keep', exitLeft: 'Take the left exit', exitRight: 'Take the right exit',
    onto: 'onto', keep: 'Keep', then: 'then',
    inDistance: (d) => `In ${d}`, now: 'Now',
  },
};

/** Human phrase for a step, in both languages. */
export function phraseFor(step, lang = 'ru') {
  const p = PHRASE[lang] ?? PHRASE.ru;
  let base;
  if (step.type === 'depart') base = p.depart;
  else if (step.type === 'arrive') {
    base = step.modifier === 'left' ? p.arriveLeft : step.modifier === 'right' ? p.arriveRight : p.arrive;
    return base;
  } else if (step.type === 'roundabout') base = p.roundabout(step.exit ?? 1);
  else if (step.type === 'merge') base = p.merge;
  else if (step.type === 'fork') base = `${p.keep} ${step.modifier?.includes('left') ? (lang === 'ru' ? 'левее' : 'left') : (lang === 'ru' ? 'правее' : 'right')}`;
  else if (step.type === 'exit') base = step.modifier?.includes('left') ? p.exitLeft : p.exitRight;
  else base = p[step.modifier] ?? p.straight;

  if (step.name && step.type !== 'roundabout') return `${base} ${p.onto} ${step.name}`;
  if (step.name) return `${base}, ${step.name}`;
  return base;
}

const SIGNIFICANT = new Set(['slight left', 'left', 'sharp left', 'slight right', 'right', 'sharp right', 'uturn']);

/**
 * Build steps from an offline graph route.
 * @param {object} g packed graph
 * @param {{coordinates:number[][], edges:number[], reversed:boolean[], distance:number, duration:number}} r
 */
export function stepsFromGraphRoute(g, r) {
  const steps = [];
  const coords = r.coordinates;

  let runDistance = 0, runDuration = 0;
  let currentName = edgeNameOf(g, r.edges[0]);
  let cursor = 0; // index into coords where the current step begins

  steps.push({
    type: 'depart', modifier: 'straight', name: currentName,
    distance: 0, duration: 0, coordinate: coords[0],
    bearingAfter: coords.length > 1 ? bearing(coords[0], coords[1]) : 0,
    geometryIndex: 0,
  });

  for (let i = 0; i < r.edges.length; i++) {
    const e = r.edges[i];
    const len = i === 0 || i === r.edges.length - 1 ? approxEdgeLen(g, r, i) : g.edgeLen[e];
    runDistance += len;
    runDuration += len / Math.max(1, g.edgeSpeed[e] / 3.6);

    const nextEdge = r.edges[i + 1];
    if (nextEdge === undefined) break;

    const inGeom = edgeGeometry(g, e, r.reversed[i]);
    const outGeom = edgeGeometry(g, nextEdge, r.reversed[i + 1]);
    const bIn = bearing(inGeom[inGeom.length - 2], inGeom[inGeom.length - 1]);
    const bOut = bearing(outGeom[0], outGeom[1]);
    const delta = bearingDelta(bIn, bOut);
    const modifier = modifierFor(delta);
    const nextName = edgeNameOf(g, nextEdge);
    const nextFlags = g.edgeFlags[nextEdge];

    const roundabout = (nextFlags & F.ROUNDABOUT) && !(g.edgeFlags[e] & F.ROUNDABOUT);
    const leavingRoundabout = (g.edgeFlags[e] & F.ROUNDABOUT) && !(nextFlags & F.ROUNDABOUT);
    const nameChanged = nextName && nextName !== currentName;
    const isLink = (nextFlags & F.LINK) && !(g.edgeFlags[e] & F.LINK);

    // A step is only worth announcing when the driver has to do something.
    const worthIt = roundabout || SIGNIFICANT.has(modifier) || (isLink && Math.abs(delta) > 8)
      || (nameChanged && Math.abs(delta) > 25);
    if (!worthIt || leavingRoundabout) { if (nextName) currentName = nextName; continue; }

    const junction = outGeom[0];
    const gi = nearestCoordIndex(coords, junction, cursor);
    steps.push({
      type: roundabout ? 'roundabout' : isLink ? 'exit' : 'turn',
      modifier, name: nextName || '',
      exit: roundabout ? countRoundaboutExit(g, r, i + 1) : undefined,
      distance: runDistance, duration: runDuration,
      coordinate: junction, bearingBefore: bIn, bearingAfter: bOut,
      geometryIndex: gi,
    });
    cursor = gi;
    runDistance = 0; runDuration = 0;
    if (nextName) currentName = nextName;
  }

  steps.push({
    type: 'arrive', modifier: 'straight', name: '',
    distance: runDistance, duration: runDuration,
    coordinate: coords[coords.length - 1], geometryIndex: coords.length - 1,
  });

  return normaliseSteps(steps, r);
}

function approxEdgeLen(g, r, i) {
  // first and last edges are entered part-way; fall back to the stored length
  return Math.min(g.edgeLen[r.edges[i]], r.distance);
}

function countRoundaboutExit(g, r, startIdx) {
  let exit = 1;
  for (let i = startIdx; i < r.edges.length; i++) {
    if (!(g.edgeFlags[r.edges[i]] & F.ROUNDABOUT)) break;
    exit++;
  }
  return Math.max(1, exit - 1);
}

function nearestCoordIndex(coords, target, from = 0) {
  let best = from, bestD = Infinity;
  for (let i = from; i < coords.length; i++) {
    const d = flatDistance(coords[i], target);
    if (d < bestD) { bestD = d; best = i; }
    if (bestD < 1) break;
  }
  return best;
}

/** Adapt OSRM `steps` into the same shape. */
export function stepsFromOSRM(legs, coordinates) {
  const steps = [];
  let geomBase = 0;
  for (const leg of legs) {
    for (const s of leg.steps ?? []) {
      const man = s.maneuver ?? {};
      const type = man.type === 'depart' ? 'depart'
        : man.type === 'arrive' ? 'arrive'
        : man.type === 'roundabout' || man.type === 'rotary' ? 'roundabout'
        : man.type === 'merge' ? 'merge'
        : man.type === 'fork' ? 'fork'
        : man.type === 'on ramp' || man.type === 'off ramp' ? 'exit'
        : 'turn';
      steps.push({
        type,
        modifier: man.modifier ?? 'straight',
        name: s.name || s.ref || '',
        ref: s.ref || '',
        exit: s.exit,
        distance: s.distance, duration: s.duration,
        coordinate: man.location,
        bearingBefore: man.bearing_before, bearingAfter: man.bearing_after,
        geometryIndex: geomBase,
      });
      geomBase += Math.max(0, (s.geometry?.coordinates?.length ?? 1) - 1);
    }
  }
  // OSRM geometry indices only line up when we requested full geometry per step;
  // recompute against the merged line so the engine can trust them.
  const cum = cumulative(coordinates);
  let travelled = 0;
  for (const s of steps) {
    s.geometryIndex = indexAtDistance(cum, travelled);
    travelled += s.distance;
  }
  return normaliseSteps(steps, { coordinates });
}

function indexAtDistance(cum, dist) {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < dist) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Fill in per-step distance-to-next and cumulative remaining values. */
function normaliseSteps(steps, r) {
  const coords = r.coordinates;
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    s.index = i;
    s.alongStart = cum[Math.min(s.geometryIndex, cum.length - 1)];
    s.nextName = steps[i + 1]?.name ?? '';
  }
  for (let i = 0; i < steps.length; i++) {
    const next = steps[i + 1];
    steps[i].distance = next ? Math.max(0, next.alongStart - steps[i].alongStart) : 0;
    steps[i].remaining = Math.max(0, total - steps[i].alongStart);
  }

  /* Drop sub-10 m stubs — usually the last metres of a snapped destination edge.
     Real navigators never announce those. `depart` and `arrive` always survive. */
  const kept = steps.filter((s, i) =>
    s.type === 'depart' || s.type === 'arrive' || s.distance >= 10 || i === 0);
  if (kept.length !== steps.length) {
    for (let i = 0; i < kept.length; i++) {
      const next = kept[i + 1];
      kept[i].index = i;
      kept[i].distance = next ? Math.max(0, next.alongStart - kept[i].alongStart) : 0;
      kept[i].nextName = next?.name ?? '';
    }
  }

  /* Mark manoeuvres that follow closely — the HUD renders these as "then …". */
  for (let i = 0; i < kept.length - 1; i++) {
    kept[i].immediateNext = kept[i].distance < 120 && kept[i + 1].type !== 'arrive';
  }
  return kept;
}

/** Icon key for the HUD — maps to an inline SVG in ui/icons.js. */
export function maneuverIcon(step) {
  if (!step) return 'straight';
  if (step.type === 'depart') return 'depart';
  if (step.type === 'arrive') return 'arrive';
  if (step.type === 'roundabout') return 'roundabout';
  if (step.type === 'merge') return 'merge';
  if (step.type === 'exit') return step.modifier?.includes('left') ? 'exit-left' : 'exit-right';
  return (step.modifier ?? 'straight').replace(' ', '-');
}
