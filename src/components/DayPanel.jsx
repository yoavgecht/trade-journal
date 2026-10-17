import React, { useEffect, useState } from 'react';
import { api, money, fmtNY } from '../api.js';
import TradePanel, { parseJsonArr, fmtDur } from './TradePanel.jsx';
import Lightbox from './Lightbox.jsx';
import { useMediaUrls } from './Media.jsx';

function TradeShots({ shots, onOpen }) {
  const urls = useMediaUrls(shots);
  if (!urls) return null;
  return (
    <div className="day-shots">
      {shots.map((name, idx) => (
        <img key={name} src={urls[idx]} alt="trade screenshot" onClick={() => onOpen(urls, idx)} />
      ))}
    </div>
  );
}

// Day Review — opened by clicking a traded day on the profit calendar. Shows
// every trade of that day with its annotations and screenshots (the
// "chartbook", indexed by calendar day). Annotate opens the shared TradePanel.
export default function DayPanel({ date, onClose, onChanged }) {
  const [trades, setTrades] = useState(null);
  const [editing, setEditing] = useState(null);
  const [v, setV] = useState(0);
  const [lb, setLb] = useState(null); // { images, start } for the screenshot lightbox
  // Manual day entry (P&L typed in without per-trade data, e.g. from a prop
  // firm dashboard). One per date.
  const [manual, setManual] = useState(null);
  const [mPnl, setMPnl] = useState('');
  const [mTrades, setMTrades] = useState('');
  const [mNote, setMNote] = useState('');
  const [mOpen, setMOpen] = useState(false);

  useEffect(() => {
    api('/trades').then((ts) => setTrades(
      ts.filter((t) => (t.exit_time || '').slice(0, 10) === date)
        .sort((a, b) => a.exit_time.localeCompare(b.exit_time)),
    ));
    api('/days').then((days) => {
      const m = days.find((d) => d.date === date) || null;
      setManual(m);
      setMPnl(m ? String(m.pnl) : '');
      setMTrades(m?.trades != null ? String(m.trades) : '');
      setMNote(m?.note || '');
      setMOpen(false);
    });
  }, [date, v]);

  const saveManual = async () => {
    const pnl = parseFloat(mPnl);
    if (Number.isNaN(pnl)) return;
    await api(`/days/${date}`, {
      method: 'PUT',
      body: { pnl, trades: mTrades === '' ? null : Number(mTrades), note: mNote || null },
    });
    setV((x) => x + 1);
    onChanged?.();
  };

  const removeManual = async () => {
    await api(`/days/${date}`, { method: 'DELETE' });
    setV((x) => x + 1);
    onChanged?.();
  };

  if (!trades) return null;
  const total = trades.reduce((s, t) => s + t.pnl, 0) + (manual?.pnl || 0);
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
        <div className="trade-sub">
          {trades.length} imported trade{trades.length !== 1 ? 's' : ''}
          {manual && ` · manual entry: ${money(manual.pnl)}${manual.trades ? ` (${manual.trades} trades)` : ''}`}
        </div>

        {/* Manual day P&L — for days without per-trade data */}
        {(manual || mOpen) ? (
          <div className="day-card" style={{ background: 'var(--panel2)' }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <b>Manual day entry</b>
              <div className="spacer" />
              {manual && <button className="ghost" style={{ padding: '4px 9px', fontSize: 12 }} onClick={removeManual}>Remove</button>}
            </div>
            <div className="row" style={{ marginBottom: 6 }}>
              <input type="number" step="0.01" placeholder="P&L ($)" value={mPnl}
                onChange={(e) => setMPnl(e.target.value)} style={{ width: 120 }} />
              <input type="number" placeholder="# trades" value={mTrades}
                onChange={(e) => setMTrades(e.target.value)} style={{ width: 90 }} />
              <input placeholder="note (optional)" value={mNote}
                onChange={(e) => setMNote(e.target.value)} style={{ flex: 1 }} />
              <button onClick={saveManual} style={{ padding: '6px 12px' }}>Save</button>
            </div>
            {manual?.note && <div className="muted" style={{ fontSize: 12 }}>{manual.note}</div>}
          </div>
        ) : (
          <button className="ghost" style={{ marginBottom: 12 }} onClick={() => setMOpen(true)}>
            ＋ Add manual P&L for this day
          </button>
        )}

        {trades.map((t) => {
          const shots = parseJsonArr(t.screenshots);
          const tags = parseJsonArr(t.mistakes);
          return (
            <div key={t.id} className="day-card">
              <div className="row" style={{ marginBottom: 4 }}>
                <b>{fmtNY(t.exit_time)}</b>
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
                <TradeShots shots={shots} onOpen={(urls, idx) => setLb({ images: urls, start: idx })} />
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
      {lb && <Lightbox images={lb.images} start={lb.start} onClose={() => setLb(null)} />}
    </>
  );
}
