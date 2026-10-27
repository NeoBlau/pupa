import { useEffect, useState } from 'react';
import { MAX_LEVEL, MODELS, TOOLS, modelMult, upgradeCost, type ModelDef } from '@shared/game.ts';
import { fmt, useStore } from '../store.ts';

function Carousel({ imgs }: { imgs: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % imgs.length), 3200 + Math.random() * 800);
    return () => clearInterval(t);
  }, [imgs.length]);
  return (
    <div className="carousel">
      {imgs.map((src, k) => (
        <img key={src} src={src} className={k === i ? 'on' : ''} alt="" draggable={false} />
      ))}
      <div className="dots">
        {imgs.map((_, k) => (
          <i key={k} className={k === i ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

export function Models() {
  const s = useStore();
  const [open, setOpen] = useState<ModelDef | null>(null);
  return (
    <div className="page">
      <h1 className="title">Models</h1>
      <div className="grid">
        {MODELS.map((m) => {
          const level = s.state.models[m.id];
          const selected = s.state.selected === m.id;
          return (
            <div key={m.id} className={`card ${selected ? 'selected' : ''}`} onClick={() => (level ? setOpen(m) : undefined)}>
              <Carousel imgs={m.cover} />
              <div className="card-foot">
                <div>
                  <b>{m.name}</b>
                  <span className="gold">{level ? `x${modelMult(m, level).toFixed(2)}` : `🪙 ${fmt(m.unlockCost)}`}</span>
                </div>
                {level ? (
                  <span className="badge">Lvl {level}</span>
                ) : (
                  <button
                    className="unlock"
                    onClick={(e) => {
                      e.stopPropagation();
                      void s.action('unlock', m.id).then((ok) => ok && s.toast(`${m.name} unlocked!`, 'good'));
                    }}
                  >
                    🔒 UNLOCK
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {open && <ModelSheet m={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ModelSheet({ m, onClose }: { m: ModelDef; onClose: () => void }) {
  const s = useStore();
  const level = s.state.models[m.id] ?? 1;
  const cost = upgradeCost(m, level);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>
          {m.name} <span className="badge">Lvl {level}</span>
        </h3>
        <p>
          Income x{modelMult(m, level).toFixed(2)}
          {level < MAX_LEVEL && <> → x{modelMult(m, level + 1).toFixed(2)}</>}
        </p>
        <div className="gallery">
          {m.gallery.map((src, i) => {
            const need = m.galleryLevels[i];
            return (
              <div key={src} className={`thumb ${level >= need ? '' : 'locked'}`}>
                <img src={src} alt="" />
                {level < need && <span>🔒 Lvl {need}</span>}
              </div>
            );
          })}
        </div>
        <p className="muted">
          Procedures:{' '}
          {TOOLS.map((t) => (
            <span key={t.id} className={level >= t.level ? '' : 'dim'}>
              {t.icon}
            </span>
          ))}
        </p>
        <div className="row">
          {s.state.selected !== m.id && (
            <button
              className="btn ghost"
              onClick={() => {
                void s.action('select', m.id);
                onClose();
              }}
            >
              Go to room
            </button>
          )}
          {level < MAX_LEVEL ? (
            <button className="btn" onClick={() => void s.action('upgrade', m.id)}>
              Level up · 🪙 {fmt(cost)}
            </button>
          ) : (
            <span className="muted">Max level</span>
          )}
        </div>
      </div>
    </div>
  );
}
