// Thin wrapper over Telegram.WebApp; everything degrades gracefully in a normal browser.

interface TgWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name?: string } };
  version: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  openInvoice(url: string, cb: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  HapticFeedback?: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(s: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  isVersionAtLeast(v: string): boolean;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

export const tg: TgWebApp | null = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  // Rubbing gestures must not close the Mini App.
  if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.('#0e0b16');
  tg.setBackgroundColor?.('#0e0b16');
}

let lastTick = 0;
export function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'tick') {
  const h = tg?.HapticFeedback;
  if (!h) {
    if (kind !== 'tick' && navigator.vibrate) navigator.vibrate(kind === 'heavy' || kind === 'error' ? 30 : 10);
    return;
  }
  if (kind === 'success' || kind === 'error') h.notificationOccurred(kind);
  else if (kind === 'tick') {
    const now = performance.now();
    if (now - lastTick < 45) return;
    lastTick = now;
    h.selectionChanged();
  } else h.impactOccurred(kind);
}

/** Auth header: signed initData inside Telegram, a dev id in a browser. */
export function authHeader() {
  if (tg) return `tma ${tg.initData}`;
  let id = localStorage.getItem('dev-id');
  if (!id) {
    id = String(1_000_000 + Math.floor(Math.random() * 1_000_000));
    localStorage.setItem('dev-id', id);
  }
  return `tma dev:${id}`;
}
