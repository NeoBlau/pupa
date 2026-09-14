/* navhud.js — the driving head-up display.
 *
 * Built once and then mutated in place: at 1 Hz with a GPS fix and 60 Hz with
 * animation, re-rendering the tree would drop frames on exactly the phones that
 * need this to be smooth.
 */

import { el, formatDistance, formatDuration, formatClock, clamp } from '../lib/util.js';
import { t, getLang } from '../i18n/strings.js';
import { icon, maneuverSVG } from './icons.js';
import { phraseFor, maneuverIcon } from '../routing/maneuvers.js';
import { CAMERA_LABEL_KEY } from '../features/cameras.js';
import { settings } from '../core/settings.js';

export class NavHUD {
  #root; #nodes = {};
  #cameraTimer = null;
  #lastManeuverKey = '';

  mount(parent) {
    const n = this.#nodes;

    /* --- manoeuvre banner --- */
    n.arrow = el('div', { class: 'maneuver-arrow', html: maneuverSVG('straight') });
    n.distance = el('div', { class: 'maneuver-distance', text: '—' });
    n.street = el('div', { class: 'maneuver-street', text: '' });
    n.thenIcon = el('span', { class: 'then-icon', html: '', style: { display: 'grid', width: '17px', height: '17px' } });
    n.thenText = el('span', { text: '' });
    n.then = el('div', { class: 'maneuver-then', style: { display: 'none' } }, n.thenIcon, n.thenText);
    n.banner = el('div', { class: 'maneuver-banner' },
      n.arrow,
      el('div', { class: 'maneuver-text' }, n.distance, n.street, n.then));

    /* --- camera alert + average-speed zone --- */
    n.cameraAlert = el('div', { class: 'camera-alert', style: { display: 'none' } });
    n.zoneStrip = el('div', { class: 'zone-strip', style: { display: 'none' } });

    /* --- speed cluster --- */
    n.speedValue = el('b', { text: '0' });
    n.speedo = el('div', { class: 'speedo' },
      el('div', {}, n.speedValue, el('span', { text: getLang() === 'ru' ? 'км/ч' : 'km/h' })));
    n.limitSign = el('div', { class: 'limit-sign hidden', text: '' });
    n.speedCluster = el('div', { class: 'speed-cluster' }, n.speedo, n.limitSign);

    /* --- bottom bar --- */
    n.eta = el('b', { text: '—' });
    n.remainingTime = el('b', { text: '—' });
    n.remainingDistance = el('b', { text: '—' });
    n.muteBtn = el('button', { class: 'nav-icon-btn', 'aria-label': t('settings.voice'),
      html: settings.get('voice') === 'off' ? icon('mute') : icon('volume') });
    n.overviewBtn = el('button', { class: 'nav-icon-btn', 'aria-label': t('nav.overview'), html: icon('layers') });
    n.endBtn = el('button', { class: 'nav-end', 'aria-label': t('nav.stop'), html: icon('close') });

    n.bottom = el('div', { class: 'nav-bottom' },
      el('div', { class: 'nav-stat' }, n.eta, el('span', { text: t('route.arrive') })),
      el('div', { class: 'nav-stat' }, n.remainingTime, el('span', { text: t('nav.remaining') })),
      el('div', { class: 'nav-stat' }, n.remainingDistance, el('span', { text: t('nav.distance') })),
      el('div', { class: 'spacer' }),
      n.overviewBtn, n.muteBtn, n.endBtn);

    this.#root = el('div', { class: 'hud' },
      n.banner, n.cameraAlert, n.zoneStrip, n.speedCluster, n.bottom);
    parent.append(this.#root);
    return this;
  }

  onMute(fn) { this.#nodes.muteBtn.addEventListener('click', fn); }
  onOverview(fn) { this.#nodes.overviewBtn.addEventListener('click', fn); }
  onEnd(fn) { this.#nodes.endBtn.addEventListener('click', fn); }

  setMuted(muted) {
    this.#nodes.muteBtn.innerHTML = muted ? icon('mute') : icon('volume');
    this.#nodes.muteBtn.classList.toggle('muted', muted);
  }

  /** Called on every navigation tick. */
  update(progress) {
    const n = this.#nodes;
    const lang = getLang();
    const step = progress.nextStep ?? progress.step;

    if (step) {
      const key = `${step.index}:${maneuverIcon(step)}`;
      if (key !== this.#lastManeuverKey) {
        n.arrow.innerHTML = maneuverSVG(maneuverIcon(step));
        this.#lastManeuverKey = key;
      }
      n.distance.textContent = progress.arrived
        ? t('nav.arrived')
        : formatDistance(progress.distanceToManeuver, lang);
      n.street.textContent = step.name || phraseFor(step, lang);

      const after = progress.stepAfterNext;
      if (after && step.immediateNext && after.type !== 'arrive') {
        n.then.style.display = '';
        n.thenIcon.innerHTML = maneuverSVG(maneuverIcon(after));
        n.thenText.textContent = `${t('nav.then')} ${phraseFor(after, lang).toLowerCase()}`;
      } else {
        n.then.style.display = 'none';
      }
    }

    n.eta.textContent = formatClock(progress.eta, lang);
    n.remainingTime.textContent = formatDuration(progress.duration, lang);
    n.remainingDistance.textContent = formatDistance(progress.remaining, lang);

    const kmh = Math.round((progress.speed ?? 0) * 3.6);
    n.speedValue.textContent = String(kmh);
  }

  /** Speed limit sign and the over-limit state of the speedometer. */
  setSpeedLimit(limit, overBy) {
    const n = this.#nodes;
    if (limit) {
      n.limitSign.textContent = String(limit);
      n.limitSign.classList.remove('hidden');
    } else {
      n.limitSign.classList.add('hidden');
    }
    n.speedo.classList.toggle('over', overBy > 0);
  }

  /** @param {{camera:object, distance:number, stage:string}|null} alert */
  setCameraAlert(alert) {
    const node = this.#nodes.cameraAlert;
    clearTimeout(this.#cameraTimer);
    if (!alert?.stage) { node.style.display = 'none'; return; }

    const { camera, distance, stage } = alert;
    node.className = `camera-alert ${stage}`;
    node.style.display = '';
    node.replaceChildren(
      el('span', { html: icon('camera'), style: { display: 'grid' } }),
      el('div', { class: 'camera-alert-main' },
        el('div', { class: 'camera-alert-title', text: t(CAMERA_LABEL_KEY[camera.kind] ?? 'camera.speed') }),
        el('div', { class: 'camera-alert-sub', text: formatDistance(distance, getLang()) })),
      camera.maxspeed
        ? el('div', { class: 'camera-alert-limit', text: String(camera.maxspeed) })
        : null);

    // the "at" stage is momentary; clear it so the banner does not linger
    if (stage === 'at') this.#cameraTimer = setTimeout(() => { node.style.display = 'none'; }, 4000);
  }

  /** @param {{average:number, limit:number|null, distance:number, projectedFine:boolean}|null} zone */
  setZone(zone) {
    const node = this.#nodes.zoneStrip;
    if (!zone) { node.style.display = 'none'; return; }
    node.style.display = '';
    node.className = `zone-strip ${zone.projectedFine ? 'over' : ''}`;
    const ratio = zone.limit ? clamp(zone.average / zone.limit, 0, 1.3) : 0;
    node.replaceChildren(
      el('span', { html: icon('camera'), style: { display: 'grid', width: '20px', height: '20px' } }),
      el('div', { style: { flex: '1', minWidth: '0' } },
        el('div', { style: { fontSize: '12px', opacity: '0.85' },
          text: `${t('camera.avgInZone')}${zone.limit ? ` · ${t('nav.speedLimit')} ${zone.limit}` : ''}` }),
        el('div', { class: 'zone-bar' }, el('i', { style: { width: `${Math.min(100, ratio * 100)}%` } }))),
      el('div', { class: 'zone-avg', text: String(Math.round(zone.average)) }));
  }

  /** Offset the camera alert below the banner, whose height varies with "then". */
  layout() {
    const bannerHeight = this.#nodes.banner.getBoundingClientRect().height;
    const top = `calc(env(safe-area-inset-top, 0px) + ${bannerHeight + 20}px)`;
    this.#nodes.cameraAlert.style.top = top;
    this.#nodes.zoneStrip.style.top = top;
  }

  show() { document.body.classList.add('navigating'); this.layout(); }
  hide() {
    document.body.classList.remove('navigating');
    this.#nodes.cameraAlert.style.display = 'none';
    this.#nodes.zoneStrip.style.display = 'none';
    this.#lastManeuverKey = '';
  }
}

export const hud = new NavHUD();
