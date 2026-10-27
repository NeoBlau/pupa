import { useSyncExternalStore } from 'react';
import {
  ITEMS,
  METER,
  PRODUCTS,
  STAGES,
  buyItem,
  claimDaily,
  newPlayer,
  peakValue,
  selectModel,
  stageIndex,
  toolBonus,
  toolById,
  unitValue,
  unlockModel,
  upgradeModel,
  useItem,
  isBoostActive,
  type ItemId,
  type PlayerState,
  type ToolId,
  type WorkBatch,
} from '@shared/game.ts';
import { authHeader, tg } from './tg.ts';
import { sfx } from './sound.ts';
import type { TattooSave } from './game/procedures/index.ts';

type ActionType = 'unlock' | 'upgrade' | 'select' | 'buyItem' | 'useItem' | 'claimDaily';
const LOCAL: Record<ActionType, (s: PlayerState, id: string, now: number) => string | null> = {
  unlock: (s, id) => unlockModel(s, id),
  upgrade: (s, id) => upgradeModel(s, id),
  select: (s, id) => selectModel(s, id),
  buyItem: (s, id) => buyItem(s, id as ItemId),
  useItem: (s, id, now) => useItem(s, id as ItemId, now),
  claimDaily: (s, _id, now) => claimDaily(s, now),
};

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'coin';
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

interface StateResp {
  state: PlayerState;
  now: number;
  botUsername?: string;
  appShortName?: string;
  userId?: number;
}

const zero = (): WorkBatch => ({ units: 0, combos: 0, coins: 0 });

class Store {
  state: PlayerState = newPlayer();
  online = false;
  offset = 0;
  botUsername = '';
  appShortName = '';
  userId = 0;
  version = 0;

  /** Mood meter 0..100 (spa procedures). */
  meter = 0;
  private lastWorkAt = 0;
  private pending = zero();
  private flushing: Promise<void> | null = null;

  toasts: Toast[] = [];
  private toastId = 0;
  private listeners = new Set<() => void>();
  soundOn = localStorage.getItem('sound') !== '0';

  now() {
    return Date.now() + this.offset;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const t = { id: ++this.toastId, text, kind };
    this.toasts = [...this.toasts.slice(-2), t];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.emit();
    }, 2600);
  }

  private apply(r: StateResp) {
    this.state = r.state;
    this.offset = r.now - Date.now();
  }

  async load() {
    try {
      const r = await api<StateResp>('state');
      this.apply(r);
      this.online = true;
      this.botUsername = r.botUsername ?? '';
      this.appShortName = r.appShortName ?? '';
      this.userId = r.userId ?? 0;
    } catch {
      // No server (e.g. static preview): play offline with local progress.
      this.online = false;
      const saved = localStorage.getItem('offline-state');
      if (saved) this.state = { ...newPlayer(), ...JSON.parse(saved) };
    }
    this.emit();
    setInterval(() => void this.flush(), 2000);
  }

  private persistOffline() {
    if (!this.online) localStorage.setItem('offline-state', JSON.stringify(this.state));
  }

  // --- gameplay ------------------------------------------------------------

  get stage() {
    return stageIndex(this.meter);
  }

  meterMult() {
    let m = 1;
    for (const id of Object.keys(ITEMS) as ItemId[]) if (isBoostActive(this.state, id, this.now())) m *= ITEMS[id].meterMult;
    return m;
  }

  work(units: number, kind: 'spa' | 'clinic') {
    const now = this.now();
    const coins = units * unitValue(this.state, this.stage, now);
    this.addCoins(coins, units, 0);
    if (kind === 'spa') {
      this.meter += units * METER.perUnit * this.meterMult();
      this.lastWorkAt = now;
      if (this.meter >= 100) {
        const bonus = peakValue(this.state, now);
        this.addCoins(bonus, 0, 1);
        this.meter = METER.afterPeak;
        this.toast(`${STAGES[STAGES.length - 1].icon} ${STAGES[STAGES.length - 1].label}! +${fmt(bonus)}`, 'coin');
        sfx('success');
      }
    }
    this.emit();
  }

  finish(tool: ToolId, accuracy: number) {
    const bonus = toolBonus(this.state, tool, accuracy, this.now());
    this.addCoins(bonus, 0, 1);
    const grade = accuracy > 0.85 ? 'Perfect' : accuracy > 0.6 ? 'Great' : accuracy > 0.3 ? 'Good' : 'Done';
    this.toast(`${toolById(tool).icon} ${grade} · +${fmt(bonus)}`, 'coin');
    sfx('coin');
    this.emit();
  }

  private addCoins(coins: number, units: number, combos: number) {
    this.state.coins += Math.floor(coins);
    this.state.totalUnits += units;
    this.pending.coins += Math.floor(coins);
    this.pending.units += units;
    this.pending.combos += combos;
    this.persistOffline();
  }

  tick(dt: number) {
    if (this.meter > 0 && this.now() - this.lastWorkAt > METER.idleBeforeDecaySec * 1000) this.meter = Math.max(0, this.meter - METER.decayPerSec * dt);
  }

  flush(): Promise<void> {
    if (!this.online) return Promise.resolve();
    if (this.flushing) return this.flushing;
    if (!this.pending.units && !this.pending.combos) return Promise.resolve();
    const batch = this.pending;
    this.pending = zero();
    this.flushing = api<StateResp>('work', batch)
      .then((r) => {
        this.apply(r);
        // Re-add whatever was earned while the request was in flight.
        this.state.coins += this.pending.coins;
        this.emit();
      })
      .catch(() => {
        this.pending.units += batch.units;
        this.pending.combos += batch.combos;
        this.pending.coins += batch.coins;
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  async action(type: ActionType, id = '') {
    const draft: PlayerState = structuredClone(this.state);
    const err = LOCAL[type](draft, id, this.now());
    if (err) {
      this.toast(err, 'bad');
      return false;
    }
    if (type === 'useItem' && ITEMS[id as ItemId]?.meterBoost) this.meter = Math.min(99, this.meter + ITEMS[id as ItemId].meterBoost);
    this.state = draft;
    this.persistOffline();
    this.emit();
    if (!this.online) return true;
    try {
      await this.flush();
      this.apply(await api<StateResp>('action', { type, id }));
      this.state.coins += this.pending.coins;
      this.emit();
      return true;
    } catch (e) {
      this.toast((e as Error).message, 'bad');
      await this.load().catch(() => {});
      return false;
    }
  }

  async buy(productId: string) {
    const p = PRODUCTS.find((x) => x.id === productId)!;
    if (!tg || !this.online) {
      this.toast('Payments work inside Telegram', 'info');
      return;
    }
    try {
      const { link } = await api<{ link: string }>('invoice', { productId });
      tg.openInvoice(link, (status) => {
        if (status !== 'paid') return;
        this.toast(`${p.icon} ${p.title} — thank you!`, 'good');
        sfx('success');
        // The grant arrives via the bot webhook; poll briefly.
        let n = 0;
        const t = setInterval(async () => {
          n++;
          await this.flush();
          const r = await api<StateResp>('state').catch(() => null);
          if (r) {
            this.apply(r);
            this.emit();
          }
          if (n >= 5) clearInterval(t);
        }, 1500);
      });
    } catch (e) {
      this.toast((e as Error).message, 'bad');
    }
  }

  async task(id: string, url: string) {
    if (tg) {
      if (url.startsWith('https://t.me/')) tg.openTelegramLink(url);
      else tg.openLink(url);
    } else window.open(url, '_blank');
    if (!this.online) return;
    // Give the user a moment to join before verifying.
    setTimeout(async () => {
      try {
        await this.flush();
        this.apply(await api<StateResp>('task', { id }));
        this.toast('Reward received!', 'good');
        this.emit();
      } catch (e) {
        this.toast((e as Error).message, 'bad');
      }
    }, 4000);
  }

  setSound(on: boolean) {
    this.soundOn = on;
    localStorage.setItem('sound', on ? '1' : '0');
    this.emit();
  }

  // Tattoos are cosmetic and stored per device.
  getTattoo(modelId: string): TattooSave | null {
    try {
      return JSON.parse(localStorage.getItem(`tattoo:${modelId}`) ?? 'null');
    } catch {
      return null;
    }
  }

  saveTattoo(modelId: string, t: TattooSave | null) {
    if (t) localStorage.setItem(`tattoo:${modelId}`, JSON.stringify(t));
    else localStorage.removeItem(`tattoo:${modelId}`);
    this.emit();
  }
}

export const store = new Store();

export function useStore() {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store;
}

export function fmt(n: number) {
  n = Math.floor(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return n.toLocaleString('en-US');
}
