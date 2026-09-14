/* icons.js — inline SVG. Bundled rather than fetched so the HUD renders offline. */

const svg = (paths, { fill = false, viewBox = '0 0 24 24' } = {}) =>
  `<svg viewBox="${viewBox}" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${paths}</svg>`;

/* ---------- manoeuvre arrows (filled, read at a glance while driving) ---------- */

const arrow = (d) => svg(`<path d="${d}"/>`, { fill: true });

export const MANEUVER_ICONS = {
  depart:    arrow('M12 21V7.8l-4.6 4.6-1.4-1.4L12 5l6 6-1.4 1.4L12 7.8V21z'),
  straight:  arrow('M12 21V7.8l-4.6 4.6-1.4-1.4L12 5l6 6-1.4 1.4L12 7.8V21z'),
  'slight-right': arrow('M14.5 4H20v5.5h-2.1V7.6l-4.1 4.1a3 3 0 0 0-.9 2.1V21h-2v-7.2a5 5 0 0 1 1.5-3.5l4.1-4.1h-2z'),
  'slight-left':  arrow('M9.5 4H4v5.5h2.1V7.6l4.1 4.1a3 3 0 0 1 .9 2.1V21h2v-7.2a5 5 0 0 0-1.5-3.5L7.5 6.2h2z'),
  right:     arrow('M13.6 3.6 19 9l-5.4 5.4-1.4-1.4 3-3H9a2 2 0 0 0-2 2v9H5v-9a4 4 0 0 1 4-4h6.2l-3-3z'),
  left:      arrow('M10.4 3.6 5 9l5.4 5.4 1.4-1.4-3-3H15a2 2 0 0 1 2 2v9h2v-9a4 4 0 0 0-4-4H8.8l3-3z'),
  'sharp-right': arrow('M8 4.6 6.6 6l4.2 4.2a3 3 0 0 1 .2 4l-4.5 5.2 1.5 1.3 4.5-5.2a5 5 0 0 0 .4-6l.1-.1 3 3V6h-6z'),
  'sharp-left':  arrow('M16 4.6 17.4 6l-4.2 4.2a3 3 0 0 0-.2 4l4.5 5.2-1.5 1.3-4.5-5.2a5 5 0 0 1-.4-6l-.1-.1-3 3V6h6z'),
  uturn:     arrow('M8 21V10a4 4 0 0 1 8 0v3.2l3-3L20.4 12 15 17.4 9.6 12 11 10.2l3 3V10a2 2 0 0 0-4 0v11z'),
  roundabout: svg('<path d="M12 21v-5.5"/><circle cx="12" cy="10" r="4.5"/><path d="M12 5.5V3"/><path d="M16.5 10H21"/><path d="M19 7.5 21.5 10 19 12.5"/>'),
  merge:     arrow('M11 21V12.8L6.4 8.2 7.8 6.8 12 11l4.2-4.2 1.4 1.4L13 12.8V21z'),
  'exit-right': arrow('M8 21V9.8L5.4 12.4 4 11l5-5 5 5-1.4 1.4L10 9.8V21zM15 4h5v5h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H15z'),
  'exit-left':  arrow('M16 21V9.8l2.6 2.6L20 11l-5-5-5 5 1.4 1.4L14 9.8V21zM9 4H4v5h2V7.4l3.3 3.3 1.4-1.4L7.4 6H9z'),
  arrive:    svg('<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
};

export const maneuverSVG = (key) => MANEUVER_ICONS[key] ?? MANEUVER_ICONS.straight;

/* ---------- interface ---------- */

export const ICONS = {
  search:   svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  close:    svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  clear:    svg('<path d="M15 9l-6 6M9 9l6 6"/>', {}),
  locate:   svg('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>'),
  compass:  svg('<circle cx="12" cy="12" r="9"/><path class="compass-needle" d="m15 9-2 5-4 1 2-5z" fill="currentColor" stroke="none"/>'),
  layers:   svg('<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>'),
  car:      svg('<path d="M5 17h14M6.5 17v2M17.5 17v2"/><path d="M4 17v-4.2a2 2 0 0 1 .2-.9L6.4 7A2 2 0 0 1 8.2 6h7.6a2 2 0 0 1 1.8 1.1l2.2 4.8a2 2 0 0 1 .2.9V17z"/><circle cx="7.5" cy="14" r="1"/><circle cx="16.5" cy="14" r="1"/>'),
  bike:     svg('<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="m6 17 4-8h4l4 8M10 9h5M14 9l-2 8"/>'),
  walk:     svg('<circle cx="13" cy="4.5" r="1.8"/><path d="m10 21 2.5-6-2-2.5V9l3.5-1.5L17 11l2.5 1"/><path d="m10 12-2 3"/>'),
  trail:    svg('<path d="M4 20c3-1 3-5 6-5s3 4 6 3 2-6 4-7"/><path d="m14 4 2.5 4h-5z" fill="currentColor" stroke="none"/>'),
  camera:   svg('<path d="M3 9h11l4 3v5H3z"/><circle cx="8" cy="13" r="2"/><path d="m15 9 3-4 3 2-2 3"/>'),
  weather:  svg('<circle cx="9" cy="9" r="3.2"/><path d="M9 2.5V4M9 14v1.5M2.5 9H4M14 9h1.5M4.5 4.5l1 1M13.5 4.5l-1 1"/><path d="M11 19h7a3 3 0 0 0 .3-6 4.2 4.2 0 0 0-8-1.2A3 3 0 0 0 11 19z"/>'),
  download: svg('<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  volume:   svg('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  mute:     svg('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="m16 9 5 6M21 9l-5 6"/>'),
  stop:     svg('<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>'),
  play:     svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
  chevron:  svg('<path d="m9 5 7 7-7 7"/>'),
  chevronDown: svg('<path d="m5 9 7 7 7-7"/>'),
  star:     svg('<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>'),
  starFill: svg('<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>', { fill: true }),
  clock:    svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  pin:      svg('<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  flag:     svg('<path d="M5 21V4M5 5h11l-2 3.5L16 12H5"/>'),
  home:     svg('<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/>'),
  work:     svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>'),
  plus:     svg('<path d="M12 5v14M5 12h14"/>'),
  trash:    svg('<path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13"/>'),
  alert:    svg('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>'),
  wind:     svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 13h14a3 3 0 1 1-3 3M3 18h7"/>'),
  eye:      svg('<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.8"/>'),
  record:   svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'),
  share:    svg('<path d="M12 3v13M8 7l4-4 4 4"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  route:    svg('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v5a4 4 0 0 0 4 4h5.5"/>'),
  offline:  svg('<path d="M3 3l18 18"/><path d="M8.5 16.5A4.5 4.5 0 0 1 9 7.6M16 8a4.5 4.5 0 0 1 2 8.5H9"/>'),
  mountain: svg('<path d="M3 19 9.5 7l4 6.5 2-3L21 19z"/><path d="m8 13 2 2 1.5-2"/>'),
  water:    svg('<path d="M12 3.5s6 6.4 6 10.2a6 6 0 1 1-12 0C6 9.9 12 3.5 12 3.5z"/>'),
  refresh:  svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  stack:    svg('<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="12" width="18" height="8" rx="1.5"/>'),
  info:     svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
};

export const icon = (name) => ICONS[name] ?? ICONS.info;

/** The location puck: a dot plus a heading cone. */
export const PUCK_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" class="puck-svg">
  <defs>
    <radialGradient id="coneGradient" cx="50%" cy="100%" r="70%">
      <stop offset="0%" stop-color="currentColor" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path class="puck-cone" d="M32 32 L12 4 A34 34 0 0 1 52 4 Z"/>
  <circle class="puck-accuracy" cx="32" cy="32" r="26" fill="currentColor" fill-opacity="0.12"/>
  <circle class="puck-dot" cx="32" cy="32" r="8"/>
</svg>`;
