import React, { useRef, useState } from 'react';
import { api, money } from '../api.js';

export const MISTAKES = [
  'revenge', 'oversized', 'no-plan', 'chased', 'moved-stop', 'early-exit',
  'late-entry', 'counter-trend', 'news', 'boredom', 'past-loss-limit',
];

export const parseJsonArr = (s) => { try { return JSON.parse(s) || []; } catch { return []; } };
export const fmtDur = (s) => s == null ? '—'
  : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;

// Slide-over edit panel: setup, mistakes, execution rating, comments, and up
// to 2 chart screenshots. Screenshots save immediately; the rest on Save.
// Used from the Trades list AND the calendar Day Review.
export default function TradePanel({ trade, onClose, onSaved }) {
  const [setup, setSetup] = useState(trade.setup || '');
  const [mistakes, setMistakes] = useState(() => parseJsonArr(trade.mistakes));
  const [notes, setNotes] = useState(trade.notes || '');
  const [rating, setRating] = useState(trade.rating || 0);
  const [shots, setShots] = useState(() => parseJsonArr(trade.screenshots));
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const toggleMistake = (m) =>
    setMistakes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const save = async () => {
    setSaving(true);
    await api(`/trades/${trade.id}/meta`, {
      method: 'PATCH',
      body: { setup: setup || null, mistakes, notes: notes || null, rating: rating || null },
    });
    setSaving(false);
    onSaved();
    onClose();
  };

  const uploadShots = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const r = await api(`/trades/${trade.id}/screenshots`, { method: 'POST', body: fd });
    setShots(r.screenshots);
    onSaved();
  };

  const removeShot = async (name) => {
    const r = await api(`/trades/${trade.id}/screenshots/${name}`, { method: 'DELETE' });
    setShots(r.screenshots);
    onSaved();
  };

  return (
    <>
      <div className="slideover-overlay" onClick={onClose} />
      <div className="slideover">
        <button className="x" onClick={onClose}>✕</button>
        <div className="trade-head">
          <span className="sym">{trade.contract}</span>
          <span className="muted">{trade.direction} × {trade.qty}</span>
          <span className={`pnl ${trade.pnl >= 0 ? 'pos' : 'neg'}`}>{money(trade.pnl)}</span>
        </div>
        <div className="trade-sub">
          {(trade.entry_time || '').replace('T', ' ')} → {(trade.exit_time || '').replace('T', ' ').slice(11)}
          {' · '}{trade.entry_price} → {trade.exit_price} ({trade.points} pts)
          {' · '}held {fmtDur(trade.duration_s)}
        </div>

        <div className="field">
          <label>Setup</label>
          <input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. ORB, VWAP fade, news fade" />
        </div>

        <div className="field">
          <label>Mistakes</label>
          <div>
            {MISTAKES.map((m) => (
              <span key={m} className={`tag ${mistakes.includes(m) ? 'on' : ''}`} onClick={() => toggleMistake(m)}>{m}</span>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Execution rating — how well you TRADED it, not how it paid</label>
          <div>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={`star ${rating >= n ? 'on' : ''}`}
                onClick={() => setRating(rating === n ? 0 : n)}>★</span>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Comments</label>
          <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={'What was the plan?\nWhat actually happened?\nWhat would you do differently?'} />
        </div>

        <div className="field">
          <label>Screenshots ({shots.length}/2)</label>
          <div className="shot-grid">
            {shots.map((name) => (
              <div key={name} className="shot">
                <img src={`/api/screenshots/${name}`} alt="trade screenshot"
                  onClick={() => window.open(`/api/screenshots/${name}`, '_blank')} />
                <button className="rm" onClick={() => removeShot(name)}>✕</button>
              </div>
            ))}
            {shots.length < 2 && (
              <div className="shot-add" onClick={() => fileRef.current.click()}>
                ＋ Add screenshot
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { uploadShots([...e.target.files]); e.target.value = ''; }} />
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  );
}
