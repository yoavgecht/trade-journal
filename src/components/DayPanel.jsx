import React, { useEffect, useState } from 'react';
import { api, money } from '../api.js';
import TradePanel, { parseJsonArr, fmtDur } from './TradePanel.jsx';

// Day Review — opened by clicking a traded day on the profit calendar. Shows
// every trade of that day with its annotations and screenshots (the
// "chartbook", indexed by calendar day). Annotate opens the shared TradePanel.
export default function DayPanel({ date, onClose }) {
  const [trades, setTrades] = useState(null);
  const [editing, setEditing] = useState(null);
  const [v, setV] = useState(0);

  useEffect(() => {
    api('/trades').then((ts) => setTrades(
      ts.filter((t) => (t.exit_time || '').slice(0, 10) === date)
        .sort((a, b) => a.exit_time.localeCompare(b.exit_time)),
    ));
  }, [date, v]);

  if (!trades) return null;
  const total = trades.reduce((s, t) => s + t.pnl, 0);
  const title = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <>
      <div className="slideover-overlay" onClick={onClose} />
      <div className="slideover wide">
        <button className="x" onClick={onClose}>✕</button>
        <div className="trade-head">
          <span className="sym">{title}</span>
          <span className={`pnl ${total >= 0 ? 'pos' : 'neg'}`}>{money(total)}</span>
        </div>
        <div className="trade-sub">{trades.length} trade{trades.length !== 1 ? 's' : ''}</div>

        {trades.map((t) => {
          const shots = parseJsonArr(t.screenshots);
          const tags = parseJsonArr(t.mistakes);
          return (
            <div key={t.id} className="day-card">
              <div className="row" style={{ marginBottom: 4 }}>
                <b>{(t.exit_time || '').slice(11, 16)}</b>
                <span>{t.contract} <span className="muted">{t.direction} × {t.qty}</span></span>
                <span className="muted">{t.entry_price} → {t.exit_price} · {fmtDur(t.duration_s)}</span>
                <div className="spacer" />
                <b className={t.pnl >= 0 ? 'pos' : 'neg'}>{money(t.pnl)}</b>
              </div>
              <div style={{ marginBottom: 4 }}>
                {t.rating ? <span style={{ color: '#f59e0b', marginRight: 6 }}>{'★'.repeat(t.rating)}</span> : null}
                {t.setup && <span className="tag">{t.setup}</span>}
                {tags.map((m) => <span key={m} className="tag on">{m}</span>)}
              </div>
              {t.notes && <div className="day-notes">{t.notes}</div>}
              {shots.length > 0 && (
                <div className="day-shots">
                  {shots.map((name) => (
                    <img key={name} src={`/api/screenshots/${name}`} alt="trade screenshot"
                      onClick={() => window.open(`/api/screenshots/${name}`, '_blank')} />
                  ))}
                </div>
              )}
              <div className="row" style={{ marginTop: 6 }}>
                <div className="spacer" />
                <button className="ghost" style={{ padding: '5px 10px', fontSize: 12 }}
                  onClick={() => setEditing(t)}>✎ Annotate</button>
              </div>
            </div>
          );
        })}
        {trades.length === 0 && <div className="muted">No trades closed on this day.</div>}
      </div>

      {editing && (
        <TradePanel trade={editing} onClose={() => setEditing(null)} onSaved={() => setV((x) => x + 1)} />
      )}
    </>
  );
}
