import { useEffect, useRef, useState } from 'react';
import {
  ITEMS,
  ITEM_IDS,
  STAGES,
  TOOLS,
  MODELS,
  currentModelMult,
  isBoostActive,
  isToolUnlocked,
  modelById,
  nextLockedModel,
  toolById,
  type ItemId,
  type ToolId,
} from '@shared/game.ts';
import { Engine } from '../game/engine.ts';
import { restoreTattoo } from '../game/procedures/index.ts';
import { ORDERS, SANDBOX_TOOLS, Sandbox, type SandboxView } from '../game/sandbox/index.ts';
import { fmt, store, useStore } from '../store.ts';
import { haptic } from '../tg.ts';
import { loop, sfx } from '../sound.ts';

export function Room({ active }: { active: boolean }) {
  const s = useStore();
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const sandbox = useRef<Sandbox | null>(null);
  const [loadPct, setLoadPct] = useState(0);
  const [view, setView] = useState<SandboxView | null>(null);
  const [mode, setMode] = useState<'spa' | 'clinic'>('spa');
  const [help, setHelp] = useState(false);
  const [orders, setOrders] = useState(false);
  const [pad, setPad] = useState(false);
  const [force, setForce] = useState(0.55);
  const [loaded, setLoaded] = useState('');
  const model = modelById(s.state.selected)!;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const tools = SANDBOX_TOOLS.filter((t) => t.group === mode || t.group === 'both');
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  // Create the 3D engine once.
  useEffect(() => {
    const e = new Engine({
      onWork: (u) => store.work(u, sandbox.current?.tool.group === 'clinic' ? 'clinic' : modeRef.current),
      onFinish: () => {},
      onStep: () => {},
      onLoad: (k) => setLoadPct(Math.round(k * 100)),
      sfx: (n) => store.soundOn && sfx(n),
      loop: (n, on) => (store.soundOn || !on) && loop(n, on),
      haptic,
      onPadState: setPad,
      onPadTool: (dir) => {
        const sb = sandbox.current;
        if (!sb) return;
        const list = toolsRef.current;
        const i = list.findIndex((t) => t.id === sb.tool.id);
        sb.setTool(list[(i + dir + list.length) % list.length].id);
        haptic('light');
      },
      onPadSub: () => {
        const sb = sandbox.current;
        const sub = sb?.tool.sub;
        if (!sb || !sub) return;
        const i = sub.findIndex((x) => x.id === sb.tool.subId);
        sb.setSub(sub[(i + 1) % sub.length].id);
      },
    });
    engine.current = e;
    if (location.search.includes('debug')) (window as unknown as { __engine: Engine; __sandbox: () => Sandbox | null }).__engine = e;
    (window as unknown as { __sandbox: () => Sandbox | null }).__sandbox = () => sandbox.current;
    if (location.search.includes('debug')) (window as unknown as { __models: typeof MODELS }).__models = MODELS;
    let alive = true;
    void e.init(host.current!, overlay.current!).then(() => {
      if (!alive) e.destroy();
    });
    return () => {
      alive = false;
      if (e.ready) e.destroy();
    };
  }, []);

  // (Re)load the foot whenever the selected model changes; start free play.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    let cancelled = false;
    const go = async () => {
      while (!e.ready) await new Promise((r) => setTimeout(r, 30));
      if (cancelled) return;
      setLoadPct(85);
      await new Promise((r) => setTimeout(r, 30));
      await e.loadModel(model);
      const t = store.getTattoo(model.id);
      if (t) restoreTattoo(e, t);
      const sb = new Sandbox(e, { getTattoo: () => store.getTattoo(model.id), saveTattoo: (x) => store.saveTattoo(model.id, x) });
      sb.onView = setView;
      sb.onOrderDone = (o, score) => store.finish(o.id, score);
      sandbox.current = sb;
      setLoaded(model.id);
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [model.id]);

  useEffect(() => {
    const e = engine.current;
    if (!e?.ready) return;
    e.setRunning(active);
  }, [active, loaded]);

  useEffect(() => {
    if (engine.current) engine.current.sliderForce = force;
  }, [force]);

  // Switching mode picks a tool that exists in the new toolbar.
  useEffect(() => {
    const sb = sandbox.current;
    if (sb && !tools.some((t) => t.id === sb.tool.id)) sb.setTool('hand');
  }, [mode, loaded]);

  // Mood meter decay.
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

  const sb = sandbox.current;
  const tool = sb?.tool;
  const order = view?.order ? ORDERS.find((o) => o.id === view.order) : null;
  const next = nextLockedModel(s.state);

  const startOrder = (id: ToolId) => {
    const def = toolById(id);
    if (!isToolUnlocked(s.state, id)) return s.toast(`${def.name} opens at ${model.name} Lvl ${def.level}`, 'info');
    setOrders(false);
    sb?.startOrder(id);
    haptic('light');
  };

  return (
    <div className={`room ${active ? '' : 'hidden'}`}>
      <div className="canvas-host" ref={host} />
      <div className="float-layer" ref={overlay} />
      {loaded !== model.id && (
        <div className="room-loading">
          <div>Preparing the room… {loadPct}%</div>
          <div className="bar small" style={{ width: 200 }}>
            <i style={{ width: `${loadPct}%` }} />
          </div>
        </div>
      )}

      <div className="room-top">
        <div className="model-tag">
          <b>{model.name}</b>
          <span>
            Lvl {s.state.models[model.id]} · x{currentModelMult(s.state).toFixed(2)}
          </span>
        </div>
        <div className="mode-switch">
          {(['spa', 'clinic'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'spa' ? '💆 SPA' : '🩺 Clinic'}
            </button>
          ))}
        </div>
        <div className="coins-pill">🪙 {fmt(s.state.coins)}</div>
      </div>

      {mode === 'spa' ? <MoodMeter /> : null}

      {/* Order checklist (or the button to pick one) */}
      <div className={`order-panel ${mode === 'clinic' ? 'clinic' : ''}`}>
        {order ? (
          <>
            <div className="step-head">
              <span>
                {order.icon} <b>{order.title}</b>
              </span>
              <button className="x" onClick={() => sb?.reset()} aria-label="End order">
                ✕
              </button>
            </div>
            <ul className="goals">
              {view!.goals.map((g) => (
                <li key={g.label} className={g.done ? 'done' : ''}>
                  <span>{g.done ? '✓' : '○'}</span>
                  {g.label}
                </li>
              ))}
            </ul>
            {!view!.complete &&
              sb &&
              order.actions?.(sb.world).map((a) => (
                <button key={a.id} className="btn wide ghost" disabled={!a.enabled} onClick={() => { a.run(); haptic('medium'); }}>
                  {a.label}
                </button>
              ))}
            {view!.complete && (
              <button className="btn wide" onClick={() => setOrders(true)}>
                Done! Next patient →
              </button>
            )}
          </>
        ) : (
          <button className="btn ghost" onClick={() => setOrders(true)}>
            📋 Orders · free play
          </button>
        )}
      </div>

      <div className="side-left">
        {ITEM_IDS.map((id) => (
          <BoostButton key={id} id={id} />
        ))}
        <button className="round" onClick={() => setHelp(true)}>
          ?
        </button>
        <button className="round" onClick={() => engine.current?.resetCamera()} title="Reset view">
          🎥
        </button>
        <button className="round" onClick={() => s.setSound(!s.soundOn)}>
          {s.soundOn ? '🔊' : '🔇'}
        </button>
      </div>

      {/* Pressure: gamepad trigger, pressure screen, or this slider */}
      <div className="force">
        {pad ? (
          <span className="pad-tag">🎮 RT = force</span>
        ) : (
          <>
            <input type="range" min={0.05} max={1} step={0.01} value={force} onChange={(ev) => setForce(Number(ev.target.value))} aria-label="Force" />
            <span>{force < 0.35 ? 'light' : force < 0.75 ? 'firm' : 'hard'}</span>
          </>
        )}
      </div>

      <div className="tool-tray">
        {tool?.sub && (
          <div className="subtools floating">
            {tool.sub.map((t) => (
              <button key={t.id} className={tool.subId === t.id ? 'on' : ''} onClick={() => sb?.setSub(t.id)}>
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        )}
        {tool && <div className="tool-hint">{tool.hint}</div>}
        {next && !order && (
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
          {tools.map((t) => (
            <button
              key={t.id}
              className={`tool ${tool?.id === t.id ? 'on' : ''}`}
              onClick={() => {
                sb?.setTool(t.id);
                haptic('light');
              }}
            >
              <span className="ic">{t.icon}</span>
              <span className="nm">{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {orders && (
        <div className="sheet-bg" onClick={() => setOrders(false)}>
          <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
            <h3>Patients</h3>
            <p className="muted">Pick an order for a checklist and a bonus — or just play freely. Every tool is always available.</p>
            <div className="order-list">
              {ORDERS.filter((o) => o.kind === mode).map((o) => {
                const def = TOOLS.find((t) => t.id === o.id)!;
                const locked = !isToolUnlocked(s.state, o.id);
                return (
                  <button key={o.id} className={`order-card ${locked ? 'locked' : ''}`} onClick={() => startOrder(o.id)}>
                    <span className="ic">{o.icon}</span>
                    <span className="tx">
                      <b>{o.title}</b>
                      <small>{o.brief}</small>
                    </span>
                    <span className="gold">{locked ? `Lvl ${def.level}` : `+${fmt(def.bonus)}`}</span>
                  </button>
                );
              })}
            </div>
            <button className="btn ghost wide" onClick={() => { sb?.reset(); setOrders(false); }}>
              New patient · free play
            </button>
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
        <p>Everything is in your hands: pick any tool, any time. The skin reacts — blood runs until you stop it, oil and foam stay until rinsed, wounds heal only when clean and dressed.</p>
        <p className="muted">
          Touch / mouse: one finger uses the tool, two fingers (right mouse) turn the camera. The <b>Force</b> slider sets how hard you press; pressure screens and pens use real pressure.
        </p>
        <p className="muted">
          🎮 Gamepad: left stick — tool · <b>RT — press (analog force)</b> · right stick — camera · LT / D-pad — zoom · LB/RB — tool · X — variant · B — reset view. Vibration follows the skin.
        </p>
        {mode === 'clinic' && (
          <p className="disclaimer">
            ⚠️ A game, not medical advice. Infected wounds and abscesses are treated by a doctor; tattooing and laser removal only by licensed specialists.
          </p>
        )}
        <button className="btn" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
