/* engine.js — turns a stream of GPS fixes into navigation state.
 *
 * The hard parts are all about not trusting the GPS too much: a fix that jumps
 * onto the parallel carriageway must not trigger a reroute, a fix that stalls
 * must not freeze the ETA, and a heading read while stationary is meaningless.
 */

import { Emitter, clamp } from '../lib/util.js';
import { nearestOnLine, cumulative, flatDistance, bearing, bearingDelta } from '../lib/geo.js';

const OFF_ROUTE_DISTANCE = 45;      // metres from the line before we start counting
const OFF_ROUTE_STRIKES = 3;        // consecutive bad fixes before we accept it
const ARRIVE_DISTANCE = 35;
const SEARCH_WINDOW = 400;          // metres of route searched around the last match

export class NavEngine extends Emitter {
  route = null;
  steps = [];
  #cum = null;
  #matchIndex = 0;
  #strikes = 0;
  #lastFix = null;
  #speedSamples = [];
  #headingSmooth = null;
  #arrived = false;
  #startedAt = 0;
  #stepIndex = 0;

  /** @param {{coordinates:number[][], distance:number, duration:number, steps:Array}} route */
  start(route) {
    this.route = route;
    this.steps = route.steps ?? [];
    this.#cum = cumulative(route.coordinates);
    this.#matchIndex = 0;
    this.#strikes = 0;
    this.#stepIndex = 0;
    this.#arrived = false;
    this.#speedSamples = [];
    this.#startedAt = Date.now();
    this.emit('started', route);
  }

  stop() {
    this.route = null; this.steps = []; this.#cum = null;
    this.emit('stopped');
  }

  get isActive() { return !!this.route; }

  /**
   * Feed a position.
   * @param {{coords:[number,number], accuracy:number, speed:number|null, heading:number|null, at:number}} fix
   * @returns {object|null} progress
   */
  update(fix) {
    if (!this.route) return null;
    const line = this.route.coordinates;

    /* Search a window around the last match rather than the whole route: it is
       far cheaper, and it stops the match from teleporting to a later crossing
       of the same street. */
    const lo = Math.max(0, this.#matchIndex - 6);
    const hi = Math.min(line.length - 1, this.#matchIndex + windowSteps(this.#cum, this.#matchIndex, SEARCH_WINDOW));
    let match = nearestOnLine(fix.coords, line, lo, hi);

    // a windowed match that looks bad may just mean the window was wrong, so
    // check the whole route once before believing it
    if (match.distance > OFF_ROUTE_DISTANCE) {
      const global = nearestOnLine(fix.coords, line);
      if (global.distance < match.distance - 5) match = global;
    }

    const along = alongFor(this.#cum, match);
    this.#matchIndex = match.index;

    const total = this.#cum[this.#cum.length - 1];
    const remaining = Math.max(0, total - along);

    /* Speed: prefer the GPS's own value, otherwise differentiate positions. */
    const speed = this.#estimateSpeed(fix);
    this.#headingSmooth = smoothHeading(this.#headingSmooth,
      Number.isFinite(fix.heading) && speed > 1.2 ? fix.heading
        : this.#lastFix ? bearing(this.#lastFix.coords, fix.coords) : this.#headingSmooth);

    /* Off-route needs hysteresis; one bad fix under a bridge is not a wrong turn. */
    const tolerance = OFF_ROUTE_DISTANCE + clamp(fix.accuracy ?? 10, 0, 40);
    let offRoute = false;
    if (match.distance > tolerance) {
      this.#strikes++;
      if (this.#strikes >= OFF_ROUTE_STRIKES) {
        offRoute = true;
        this.emit('off-route', { fix, deviation: match.distance });
        this.#strikes = 0;
      }
    } else {
      this.#strikes = Math.max(0, this.#strikes - 1);
    }

    /* Advance the manoeuvre pointer. */
    const prevStep = this.#stepIndex;
    // 15 m of slack absorbs the small difference between the planner's geometry
    // length and the one measured here
    while (this.#stepIndex < this.steps.length - 1
           && along >= this.steps[this.#stepIndex + 1].alongStart - 15) {
      this.#stepIndex++;
    }
    const step = this.steps[this.#stepIndex] ?? null;
    const nextStep = this.steps[this.#stepIndex + 1] ?? null;
    const stepAfterNext = this.steps[this.#stepIndex + 2] ?? null;
    if (this.#stepIndex !== prevStep) this.emit('step', { step, nextStep, index: this.#stepIndex });

    const distanceToManeuver = nextStep ? Math.max(0, nextStep.alongStart - along) : remaining;

    /* ETA: scale the planned duration by how far is left, then correct with the
       speed actually being driven so a slow run does not keep promising the
       original arrival time. */
    const plannedRemaining = this.route.duration * (remaining / Math.max(1, total));
    const observed = speed > 2 ? remaining / speed : null;
    const duration = observed ? plannedRemaining * 0.65 + observed * 0.35 : plannedRemaining;
    const eta = new Date(Date.now() + duration * 1000);

    const arrived = remaining <= ARRIVE_DISTANCE
      || flatDistance(fix.coords, line[line.length - 1]) <= ARRIVE_DISTANCE;
    if (arrived && !this.#arrived) {
      this.#arrived = true;
      this.emit('arrived', { fix });
    }

    const progress = {
      snapped: match.point,
      deviation: match.distance,
      along, remaining, total,
      fraction: clamp(along / Math.max(1, total), 0, 1),
      duration, eta,
      speed,
      heading: this.#headingSmooth ?? 0,
      step, nextStep, stepAfterNext, stepIndex: this.#stepIndex,
      stepsLength: this.steps.length,
      distanceToManeuver,
      offRoute, arrived: this.#arrived,
      elapsed: (Date.now() - this.#startedAt) / 1000,
    };

    this.#lastFix = fix;
    this.emit('progress', progress);
    return progress;
  }

  #estimateSpeed(fix) {
    let value = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
    if (value == null && this.#lastFix) {
      const dt = (fix.at - this.#lastFix.at) / 1000;
      if (dt > 0.2 && dt < 15) value = flatDistance(this.#lastFix.coords, fix.coords) / dt;
    }
    if (value == null) return this.#speedSamples.at(-1) ?? 0;
    // a three-sample median rejects the occasional absurd GPS spike
    this.#speedSamples.push(value);
    if (this.#speedSamples.length > 5) this.#speedSamples.shift();
    const sorted = [...this.#speedSamples].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  }
}

/** How many vertices ahead cover `metres` of route. */
function windowSteps(cum, index, metres) {
  const target = cum[Math.min(index, cum.length - 1)] + metres;
  let i = index;
  while (i < cum.length - 1 && cum[i] < target) i++;
  return Math.max(3, i - index);
}

const alongFor = (cum, match) => cum[match.index] + match.t * (cum[match.index + 1] - cum[match.index]);

/** Circular exponential smoothing — averaging 359° and 1° must give 0°, not 180°. */
function smoothHeading(previous, next, factor = 0.35) {
  if (!Number.isFinite(next)) return previous;
  if (previous == null) return next;
  return (previous + bearingDelta(previous, next) * factor + 360) % 360;
}

export const engine = new NavEngine();
