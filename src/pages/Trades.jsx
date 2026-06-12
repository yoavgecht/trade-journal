import React, { useEffect, useState } from 'react';
import { api, money } from '../api.js';

const MISTAKES = [
  'revenge', 'oversized', 'no-plan', 'chased', 'moved-stop', 'early-exit',
  'late-entry', 'counter-trend', 'news', 'boredom', 'past-loss-limit',
];

function TradeRow({ t, onSaved }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(t.notes || '');
  const [setup, setSetup] = useState(t.setup || '');
  const [mistakes, setMistakes] = useState(() => { try { return JSON.parse(t.mistakes) || []; } catch { return []; } });
  const [saving, setSaving] = useState(false);

  const toggleMistake = (m) =>
    setMistakes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const save = async () => {
    setSaving(true);
    await api(`/trades/${t.id}/meta`, { method: 'PATCH', body: { setup: setup || null, mistakes, notes: notes || null, rating: t.rating } });
    setSaving(false);
    setOpen(false);
    onSaved();
  };

  const dur = t.duration_s == null ? '—'
    : t.duration_s < 60 ? `${t.duration_s}s`
    : t.duration_s < 3600 ? `${Math.round(t.duration_s / 60)}m`
    : `${(t.duration_s / 3600).toFixed(1)}h`;

  return (
    <>
      <tr onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <td>{(t.exit_time || '').replace('T', ' ').slice(0, 16)}</td>
        <td>{t.contract}</td>
        <td>{t.direction}</td>
        <td>{t.qty}</td>
        <td>{t.entry_price} → {t.exit_price}</td>
        <td>{dur}</td>
        <td className={t.pnl >= 0 ? 'pos' : 'neg'}>{money(t.pnl)}</td>
        <td>
          {(JSON.parse(t.mistakes || '[]')).map((m) => <span key={m} className="tag on">{m}</span>)}
          {t.setup && <span className="tag">{t.setup}</span>}
          {t.notes && '📝'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ background: 'var(--panel2)' }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="muted">Setup:</span>
              <input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. ORB, VWAP fade" />
              <span className="muted">Mistakes:</span>
              {MISTAKES.map((m) => (
                <span key={m} className={`tag ${mistakes.includes(m) ? 'on' : ''}`} onClick={() => toggleMistake(m)}>{m}</span>
              ))}
            </div>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened? What would you do differently?" />
            <div className="row" style={{ marginTop: 8 }}>
              <div className="spacer" />
              <button className="ghost" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>Cancel</button>
              <button disabled={saving} onClick={(e) => { e.stopPropagation(); save(); }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Trades({ dataVersion }) {
  const [trades, setTrades] = useState([]);
  const [filter, setFilter] = useState('all');
  const [v, setV] = useState(0);
  useEffect(() => { api('/trades').then(setTrades); }, [dataVersion, v]);

  const shown = trades.filter((t) =>
    filter === 'all' ? true : filter === 'wins' ? t.pnl > 0 : filter === 'losses' ? t.pnl < 0 : true);

  return (
    <>
      <h1>Trades</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All ({trades.length})</option>
          <option value="wins">Wins</option>
          <option value="losses">Losses</option>
        </select>
        <span className="muted">Click a trade to tag mistakes and add notes.</span>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Closed</th><th>Contract</th><th>Dir</th><th>Qty</th><th>Entry → Exit</th><th>Held</th><th>P&L</th><th>Tags</th></tr>
          </thead>
          <tbody>
            {shown.map((t) => <TradeRow key={t.id} t={t} onSaved={() => setV((x) => x + 1)} />)}
            {shown.length === 0 && <tr><td colSpan={8} className="muted">No trades.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
