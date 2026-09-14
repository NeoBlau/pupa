/* store.js — live application state: position, route, navigation, connectivity. */

import { Emitter } from '../lib/util.js';

class Store extends Emitter {
  state = {
    online: navigator.onLine,
    /** @type {{coords:[number,number], accuracy:number, heading:number|null, speed:number|null, at:number}|null} */
    position: null,
    positionError: null,
    /** Heading used for map rotation — GPS course, smoothed. */
    heading: 0,
    /** @type {'idle'|'planning'|'navigating'|'arrived'} */
    mode: 'idle',
    origin: null,          // {coords, name}
    destination: null,     // {coords, name}
    waypoints: [],
    routes: [],            // computed alternatives
    activeRouteIndex: 0,
    routeSource: null,     // 'online' | 'offline'
    navProgress: null,     // see nav/engine.js
    followMode: 'follow',  // follow | free | overview
    weather: null,
    trails: [],
    activeTrail: null,
    regions: [],
    downloading: null,
    upcomingCamera: null,
    speedLimit: null,
    toast: null,
  };

  set(partial) {
    const changed = [];
    for (const [k, v] of Object.entries(partial)) {
      if (this.state[k] === v) continue;
      this.state[k] = v;
      changed.push(k);
    }
    if (!changed.length) return;
    for (const k of changed) this.emit(`change:${k}`, this.state[k]);
    this.emit('change', changed);
  }

  get activeRoute() { return this.state.routes[this.state.activeRouteIndex] ?? null; }
  get hasRoute()    { return this.state.routes.length > 0; }
  get isNavigating(){ return this.state.mode === 'navigating'; }
  get coords()      { return this.state.position?.coords ?? null; }
}

export const store = new Store();

addEventListener('online',  () => store.set({ online: true }));
addEventListener('offline', () => store.set({ online: false }));
