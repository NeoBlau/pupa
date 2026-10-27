import { DAILY_REWARDS, REF_BONUS, TASKS, dailyStatus } from '@shared/game.ts';
import { fmt, useStore } from '../store.ts';
import { tg } from '../tg.ts';

export function Earn() {
  const s = useStore();
  const d = dailyStatus(s.state, s.now());
  const link = s.botUsername && s.appShortName ? `https://t.me/${s.botUsername}/${s.appShortName}?startapp=ref_${s.userId}` : '';

  const share = () => {
    if (!link) {
      s.toast('Invite links work once the bot is connected', 'info');
      return;
    }
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me in the spa 💆‍♀️')}`;
    if (tg) tg.openTelegramLink(url);
    else window.open(url, '_blank');
  };

  return (
    <div className="page">
      <h1 className="title">Earn</h1>

      <section className="panel">
        <h4>Daily reward</h4>
        <div className="daily">
          {DAILY_REWARDS.map((r, i) => {
            const got = d.claimedToday ? i <= d.index : i < d.index;
            const today = i === d.index;
            return (
              <div key={i} className={`day ${got ? 'got' : ''} ${today && !d.claimedToday ? 'today' : ''}`}>
                <small>Day {i + 1}</small>
                <b>{fmt(r)}</b>
              </div>
            );
          })}
        </div>
        <button className="btn wide" disabled={d.claimedToday} onClick={() => void s.action('claimDaily')}>
          {d.claimedToday ? 'Come back tomorrow' : `Claim 🪙 ${fmt(DAILY_REWARDS[d.index])}`}
        </button>
      </section>

      <section className="panel">
        <h4>Invite friends</h4>
        <p className="muted">
          You get 🪙 {fmt(REF_BONUS.inviter)}, your friend gets 🪙 {fmt(REF_BONUS.invitee)}. Invited: <b>{s.state.refCount}</b>
        </p>
        <div className="row">
          <button className="btn" onClick={share}>
            Invite
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (!link) return share();
              void navigator.clipboard?.writeText(link);
              s.toast('Link copied', 'good');
            }}
          >
            Copy link
          </button>
        </div>
      </section>

      <section className="panel">
        <h4>Tasks</h4>
        {TASKS.map((t) => {
          const done = s.state.tasks.includes(t.id);
          return (
            <div key={t.id} className="task">
              <span>{t.title}</span>
              <button className="btn ghost" disabled={done} onClick={() => void s.task(t.id, t.url)}>
                {done ? '✓' : `+${fmt(t.reward)}`}
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
