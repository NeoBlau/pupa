import { useEffect, useRef, useState } from 'react';
import {
  ITEMS,
  ITEM_IDS,
  STAGES,
  TOOLS,
  currentModelMult,
  isBoostActive,
  isToolUnlocked,
  modelById,
  nextLockedModel,
  type ItemId,
  type ToolDef,
} from '@shared/game.ts';
import { Engine, type StepView } from '../game/engine.ts';
import { createProcedure, restoreTattoo } from '../game/procedures/index.ts';
import { fmt, store, useStore } from '../store.ts';
import { haptic } from '../tg.ts';
import { loop, sfx } from '../sound.ts';

export function Room({ active }: { active: boolean }) {
  const s = useStore();
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [view, setView] = useState<StepView | null>(null);
  const [mode, setMode] = useState<'spa' | 'clinic'>('spa');
  const [help, setHelp] = useState(false);
  const [loaded, setLoaded] = useState('');
  const model = modelById(s.state.selected)!;

  // Create the Pixi engine once.
  useEffect(() => {
    const e = new Engine({
      onWork: (u) => {
        const id = e.procedure?.id;
        if (id) store.work(u, id);
      },
      onFinish: (tool, acc) => store.finish(tool, acc),
      onStep: setView,
      sfx: (n) => store.soundOn && sfx(n),
      loop: (n, on) => (store.soundOn || !on) && loop(n, on),
      haptic,
    });
    engine.current = e;
    if (location.search.includes('debug')) (window as unknown as { __engine: Engine }).__engine = e;
    let alive = true;
    void e.init(host.current!).then(() => {
      if (!alive) e.destroy();
    });
    return () => {
      alive = false;
      if (e.ready) e.destroy();
    };
  }, []);

  // (Re)load the room whenever the selected model changes.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    let cancelled = false;
    const go = async () => {
      while (!e.ready) await new Promise((r) => setTimeout(r, 30));
      if (cancelled) return;
      await e.loadModel(model);
      const t = store.getTattoo(model.id);
      if (t) restoreTattoo(e, t);
      setLoaded(model.id);
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [model.id]);

  // Pause rendering while another tab is open.
  useEffect(() => {
    const e = engine.current;
    if (!e?.ready) return;
    if (active) e.app.ticker.start();
    else e.app.ticker.stop();
  }, [active, loaded]);

  // Meter decay.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const f = (t: number) => {
      store.tick((t - last) / 1000);
      last = t;
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = (tool: ToolDef) => {
    const e = engine.current;
    if (!e || loaded !== model.id) return;
    if (!isToolUnlocked(s.state, tool.id)) {
      s.toast(`${tool.name} opens at ${model.name} Lvl ${tool.level}`, 'info');
      return;
    }
    if (tool.id === 'removal' && !s.getTattoo(model.id)) {
      s.toast('No tattoo to remove yet — make one first', 'info');
      return;
    }
    if (tool.id === 'tattoo' && s.getTattoo(model.id)) {
      s.toast('She already has a tattoo — remove it first', 'info');
      return;
    }
    haptic('light');
    e.setProcedure(
      createProcedure(tool.id, e, {
        model,
        getTattoo: () => store.getTattoo(model.id),
        saveTattoo: (t) => store.saveTattoo(model.id, t),
      }),
    );
  };

  const stop = () => engine.current?.setProcedure(null);
  const tools = TOOLS.filter((t) => t.kind === mode);
  const running = view && !view.finished;
  const next = nextLockedModel(s.state);

  return (
    <div className={`room ${active ? '' : 'hidden'}`}>
      <div className="canvas-host" ref={host} />
      {loaded !== model.id && <div className="room-loading">Preparing the room…</div>}

      <div className="room-top">
        <div className="model-tag">
          <b>{model.name}</b>
          <span>
            Lvl {s.state.models[model.id]} · x{currentModelMult(s.state).toFixed(2)}
          </span>
        </div>
        <div className="mode-switch">
          {(['spa', 'clinic'] as const).map((m) => (
            <button
              key={m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                if (running) stop();
                setMode(m);
              }}
            >
              {m === 'spa' ? '💆 SPA' : '🩺 Clinic'}
            </button>
          ))}
        </div>
        <div className="coins-pill">🪙 {fmt(s.state.coins)}</div>
      </div>

      {mode === 'spa' ? <MoodMeter /> : <HealingBar view={view} />}

      {running && view && (
        <div className="step-panel">
          <div className="step-head">
            <span>
              {view.index + 1}/{view.steps.length} · <b>{view.title}</b>
            </span>
            <button className="x" onClick={stop} aria-label="Stop">
              ✕
            </button>
          </div>
          <div className="step-hint">{view.hint}</div>
          <div className="bar">
            <i style={{ width: `${view.progress * 100}%` }} />
          </div>
          <div className="step-dots">
            {view.steps.map((t, i) => (
              <span key={i} className={i < view.index ? 'done' : i === view.index ? 'cur' : ''} title={t} />
            ))}
          </div>
          {view.tools && (
            <div className="subtools">
              {view.tools.map((t) => (
                <button key={t.id} className={view.tool === t.id ? 'on' : ''} onClick={() => engine.current?.selectTool(t.id)}>
                  <span>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="side-left">
        {ITEM_IDS.map((id) => (
          <BoostButton key={id} id={id} />
        ))}
        <button className="round" onClick={() => setHelp(true)}>
          ?
        </button>
        <button className="round" onClick={() => s.setSound(!s.soundOn)}>
          {s.soundOn ? '🔊' : '🔇'}
        </button>
      </div>

      {!running && (
        <div className="tool-tray">
          {next && (
            <div className="next-model">
              <span>
                {fmt(s.state.coins)} / {fmt(next.unlockCost)} → <b>{next.name}</b> 🔒
              </span>
              <div className="bar small">
                <i style={{ width: `${Math.min(100, (s.state.coins / next.unlockCost) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="tools">
            {tools.map((t) => {
              const locked = !isToolUnlocked(s.state, t.id);
              return (
                <button key={t.id} className={`tool ${locked ? 'locked' : ''}`} onClick={() => start(t)}>
                  <span className="ic">{t.icon}</span>
                  <span className="nm">{t.name}</span>
                  {locked && <span className="lv">Lvl {t.level}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {help && <Help mode={mode} onClose={() => setHelp(false)} />}
    </div>
  );
}

function MoodMeter() {
  const fill = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const icons = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastStage = -1;
    const f = () => {
      const m = store.meter;
      if (fill.current) fill.current.style.width = `${m}%`;
      const st = store.stage;
      if (st !== lastStage && label.current) {
        lastStage = st;
        label.current.textContent = STAGES[st].label;
        label.current.classList.remove('pop');
        void label.current.offsetWidth;
        label.current.classList.add('pop');
        icons.current?.querySelectorAll('span').forEach((el, i) => el.classList.toggle('lit', i <= st));
      }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="meter-wrap">
      <div className="meter">
        <div className="meter-fill" ref={fill} />
        <div className="meter-icons" ref={icons}>
          {STAGES.map((st) => (
            <span key={st.id}>{st.icon}</span>
          ))}
        </div>
      </div>
      <div className="meter-label" ref={label}>
        {STAGES[0].label}
      </div>
    </div>
  );
}

function HealingBar({ view }: { view: StepView | null }) {
  const p = view ? (view.finished ? 1 : (view.index + view.progress) / view.steps.length) : 0;
  return (
    <div className="meter-wrap">
      <div className="meter healing">
        <div className="meter-fill" style={{ width: `${p * 100}%` }} />
        <div className="meter-icons">
          <span className={p > 0 ? 'lit' : ''}>🩸</span>
          <span className={p > 0.33 ? 'lit' : ''}>🧴</span>
          <span className={p > 0.66 ? 'lit' : ''}>🩹</span>
          <span className={p >= 1 ? 'lit' : ''}>✨</span>
        </div>
      </div>
      <div className="meter-label">{view ? (view.finished ? 'HEALED' : 'HEALING') : 'CLINIC'}</div>
    </div>
  );
}

function BoostButton({ id }: { id: ItemId }) {
  const s = useStore();
  const def = ITEMS[id];
  const [, force] = useState(0);
  const until = s.state.boosts[id] ?? 0;
  const active = isBoostActive(s.state, id, s.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [active]);
  const left = Math.max(0, Math.ceil((until - s.now()) / 1000));
  return (
    <button className={`boost ${active ? 'active' : ''}`} onClick={() => void s.action('useItem', id)}>
      <span className="ic">{def.icon}</span>
      <span className="cnt">{s.state.items[id] ?? 0}</span>
      <span className="nm">{active ? `${left}s` : def.name}</span>
    </button>
  );
}

function Help({ mode, onClose }: { mode: 'spa' | 'clinic'; onClose: () => void }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>How to play</h3>
        {mode === 'spa' ? (
          <p>Pick a procedure and follow the steps at the top. Spa work fills her mood meter — every stage multiplies your coins, and reaching the top pays a big bonus.</p>
        ) : (
          <>
            <p>Clinic procedures follow real-world order: clean → treat → aftercare → dressing. Precision and gentle handling raise your bonus (up to x2).</p>
            <p className="disclaimer">
              ⚠️ This is a game, not medical advice. Infected wounds and abscesses must be treated by a doctor; tattooing and laser removal are done only by licensed specialists.
            </p>
          </>
        )}
        <button className="btn" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
