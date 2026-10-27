import { useEffect, useState } from 'react';
import { MODELS, modelById } from '@shared/game.ts';
import { store, useStore } from './store.ts';
import { Room } from './screens/Room.tsx';
import { Models } from './screens/Models.tsx';
import { Shop } from './screens/Shop.tsx';
import { Earn } from './screens/Earn.tsx';
import { haptic } from './tg.ts';

type Tab = 'room' | 'models' | 'shop' | 'earn';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'room', icon: '🚪', label: 'Room' },
  { id: 'models', icon: '🔥', label: 'Models' },
  { id: 'shop', icon: '🏪', label: 'Shop' },
  { id: 'earn', icon: '👥', label: 'Earn' },
];

const LOADING_LINES = ['Preparing your private room…', 'Warming up the oils…', 'She is getting ready for you…'];

function preload(src: string) {
  return new Promise<void>((res) => {
    const img = new Image();
    img.onload = img.onerror = () => res();
    img.src = src;
  });
}

function Loading({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    void (async () => {
      const minTime = new Promise((r) => setTimeout(r, 1400));
      setP(0.15);
      await store.load();
      setP(0.4);
      const m = modelById(store.state.selected) ?? MODELS[0];
      const imgs = [...MODELS.map((x) => x.cover[0]), m.cover[1]];
      let n = 0;
      await Promise.all(imgs.map((src) => preload(src).then(() => setP(0.4 + 0.55 * (++n / imgs.length)))));
      await document.fonts?.ready;
      await minTime;
      setP(1);
      setTimeout(onDone, 250);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shown = Math.round(Math.min(1, p) * 100);
  return (
    <div className="loading">
      <div className="logo-orb">💆‍♀️</div>
      <h1 className="brand">SOLE SPA</h1>
      <ul className="checklist">
        {LOADING_LINES.map((l, i) => {
          const done = shown >= ((i + 1) / LOADING_LINES.length) * 100 - 1;
          const cur = !done && shown >= (i / LOADING_LINES.length) * 100;
          return (
            <li key={l} className={done ? 'done' : cur ? 'cur' : ''}>
              <span>{done ? '✓' : cur ? '💫' : '·'}</span>
              {l}
            </li>
          );
        })}
      </ul>
      <div className="load-bar">
        <i style={{ width: `${shown}%` }} />
        <b>{shown}%</b>
      </div>
    </div>
  );
}

function AgeGate({ onOk }: { onOk: () => void }) {
  return (
    <div className="loading">
      <div className="logo-orb">🔞</div>
      <h2>Adults only</h2>
      <p className="muted center">This app contains suggestive content and realistic medical procedures. Confirm that you are 18 or older.</p>
      <button
        className="btn wide"
        onClick={() => {
          localStorage.setItem('age-ok', '1');
          onOk();
        }}
      >
        I am 18+
      </button>
      <button className="btn ghost wide" onClick={() => window.Telegram?.WebApp ? (window.Telegram.WebApp as unknown as { close(): void }).close() : history.back()}>
        Leave
      </button>
    </div>
  );
}

function Toasts() {
  const s = useStore();
  return (
    <div className="toasts">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [phase, setPhase] = useState<'age' | 'loading' | 'main'>(localStorage.getItem('age-ok') ? 'loading' : 'age');
  const [tab, setTab] = useState<Tab>('room');

  if (phase === 'age') return <AgeGate onOk={() => setPhase('loading')} />;
  if (phase === 'loading') return <Loading onDone={() => setPhase('main')} />;

  return (
    <div className="app">
      <Room active={tab === 'room'} />
      {tab === 'models' && <Models />}
      {tab === 'shop' && <Shop />}
      {tab === 'earn' && <Earn />}
      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => {
              haptic('light');
              setTab(t.id);
            }}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
