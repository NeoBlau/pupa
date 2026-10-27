import { useState } from 'react';
import { ITEMS, ITEM_IDS, PRODUCTS, type ProductDef } from '@shared/game.ts';
import { fmt, useStore } from '../store.ts';

const TABS: { id: ProductDef['tab']; label: string }[] = [
  { id: 'coins', label: 'Coins' },
  { id: 'consumables', label: 'Consumables' },
  { id: 'models', label: 'Models' },
];

export function Shop() {
  const s = useStore();
  const [tab, setTab] = useState<ProductDef['tab']>('coins');
  const [cur, setCur] = useState<'stars' | 'ton'>('stars');
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="title">Store</h1>
        <div className="coins-pill">🪙 {fmt(s.state.coins)}</div>
      </div>
      <div className="seg">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="seg small">
        <button className={cur === 'stars' ? 'on' : ''} onClick={() => setCur('stars')}>
          ⭐ Stars
        </button>
        <button className={cur === 'ton' ? 'on' : ''} onClick={() => setCur('ton')}>
          💎 TON <small>soon</small>
        </button>
      </div>

      {PRODUCTS.filter((p) => p.tab === tab).map((p) => {
        const owned = !!p.grant.models?.length && p.grant.models.every((id) => id in s.state.models);
        return (
        <div key={p.id} className="product">
          <div className="p-icon">{p.icon}</div>
          <div className="p-body">
            <b>{p.title}</b>
            <span>{p.desc}</span>
            <span className="price">{cur === 'stars' ? `⭐ ${p.stars}` : `💎 ${p.ton} TON`}</span>
          </div>
          <button className="btn" disabled={cur === 'ton' || owned} onClick={() => void s.buy(p.id)}>
            {owned ? 'Owned' : 'Buy'}
          </button>
        </div>
        );
      })}

      {tab === 'consumables' && (
        <>
          <h4 className="sub">For coins</h4>
          {ITEM_IDS.map((id) => (
            <div key={id} className="product">
              <div className="p-icon">{ITEMS[id].icon}</div>
              <div className="p-body">
                <b>
                  {ITEMS[id].name} <small className="muted">×{s.state.items[id] ?? 0}</small>
                </b>
                <span>{ITEMS[id].desc}</span>
              </div>
              <button className="btn ghost" onClick={() => void s.action('buyItem', id)}>
                🪙 {fmt(ITEMS[id].coinPrice)}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
