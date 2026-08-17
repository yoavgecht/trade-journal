import React, { useRef, useState } from 'react';
import { api, money } from '../api.js';

export const MISTAKES = [
  'revenge', 'oversized', 'no-plan', 'chased', 'moved-stop', 'early-exit',
  'late-entry', 'counter-trend', 'news', 'boredom', 'past-loss-limit',
];

// Film-room review options. Labels shown to the user; the stored value is the
// first token (kept in sync with stats.js groupings).
export const DIRECTION_CALLS = [['right', 'Right ✓'], ['wrong', 'Wrong ✗']];
export const ENTRY_TIMINGS = [['early', 'Too early'], ['good', 'On time'], ['late', 'Late'], ['chased', 'Chased']];
export const MARKET_MOVES = [
  ['trend', 'Trend'], ['pullback', 'Pullback'], ['breakout', 'Breakout'],
  ['reversal', 'Reversal'], ['range', 'Range / chop'], ['news', 'News spike'],
];
export const INTUITIONS = [['plan', 'Followed plan'], ['gut', 'Gut feel']];

// Single-choice chip row; click the active one again to clear it.
function Pick({ options, value, onChange }) {
  return (
    <div className="chip-row">
      {options.map(([val, label]) => (
        <span key={val} className={`tag ${value === val ? 'sel' : ''}`}
          onClick={() => onChange(value === val ? '' : val)}>{label}</span>
      ))}
    </div>
  );
}

// Collapsible section (accordion). Non-critical sections start collapsed to keep
// the panel short — the whole review should fit with little or no scrolling.
function Section({ title, sub, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="tp-section">
      <button type="button" className="tp-sec-head" onClick={() => setOpen((o) => !o)}>
        <span className="tp-sec-title">{title}</span>
        {sub && <span className="tp-sec-sub">{sub}</span>}
        <span className="spacer" />
        <span className={`tp-chev ${open ? 'open' : ''}`}>⌄</span>
      </button>
      {open && <div className="tp-sec-body">{children}</div>}
    </div>
  );
}

export const parseJsonArr = (s) => { try { return JSON.parse(s) || []; } catch { return []; } };
export const fmtDur = (s) => s == null ? '—'
  : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;

const RATING_WORD = ['', 'Poor', 'Weak', 'Solid', 'Good', 'Great'];

// Slide-over edit panel: Film Room clip + tags, trade details, and reflection
// (rating, mistakes, comments). Top-down flow — Film Room review first, then
// details, then reflection. The clip saves immediately; the rest on Save. Used
// from the Closed Trades list AND the calendar Day Review.
export default function TradePanel({ trade, onClose, onSaved }) {
  const [setup, setSetup] = useState(trade.setup || '');
  const [mistakes, setMistakes] = useState(() => parseJsonArr(trade.mistakes));
  const [notes, setNotes] = useState(trade.notes || '');
  const [rating, setRating] = useState(trade.rating || 0);
  const [stop, setStop] = useState(trade.stop ?? '');
  const [target, setTarget] = useState(trade.target ?? '');
  const [dirCall, setDirCall] = useState(trade.direction_call || '');
  const [timing, setTiming] = useState(trade.entry_timing || '');
  const [move, setMove] = useState(trade.market_move || '');
  const [intuition, setIntuition] = useState(trade.intuition || '');
  const [mfe, setMfe] = useState(trade.mfe_points ?? '');
  // Manual trades only — the instrument/direction were set in "Add trade to
  // review" and may be wrong (e.g. logged NQ but it was MNQ). Editable below.
  const [product, setProduct] = useState(trade.product || 'NQ');
  const [direction, setDirection] = useState(trade.direction || 'long');
  const [qty, setQty] = useState(trade.qty || 1);
  const [video, setVideo] = useState(trade.video || null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoDrag, setVideoDrag] = useState(false);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef();

  const toggleMistake = (m) =>
    setMistakes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const save = async () => {
    setSaving(true);
    await api(`/trades/${trade.id}/meta`, {
      method: 'PATCH',
      body: { setup: setup || null, mistakes, notes: notes || null, rating: rating || null,
        stop: stop === '' ? null : Number(stop), target: target === '' ? null : Number(target),
        direction_call: dirCall || null, entry_timing: timing || null, market_move: move || null,
        intuition: intuition || null, mfe_points: mfe === '' ? null : Number(mfe) },
    });
    // Manual trades: persist any instrument/direction correction (own endpoint).
    if (trade.source === 'manual') {
      const core = {};
      if (product !== trade.product) core.product = product;
      if (direction !== trade.direction) core.direction = direction;
      if (Number(qty) !== trade.qty) core.qty = Number(qty);
      if (Object.keys(core).length) await api(`/trades/${trade.id}`, { method: 'PATCH', body: core });
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  // Film Room clip — video files only, capped at ~10 minutes and 500 MB. Both are
  // checked here in the browser (the server can't read duration without ffprobe;
  // it also enforces the 500 MB cap as a backstop).
  const MAX_VIDEO_SEC = 630;                  // ~10 min + small tolerance
  const MAX_VIDEO_BYTES = 500 * 1024 * 1024;  // 500 MB
  const uploadVideo = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { alert('Please choose a video file.'); return; }
    if (file.size > MAX_VIDEO_BYTES) {
      alert(`That file is ${(file.size / 1024 / 1024).toFixed(0)} MB — please keep the clip under 500 MB.`);
      return;
    }
    const dur = await new Promise((resolve) => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.onloadedmetadata = () => { URL.revokeObjectURL(el.src); resolve(el.duration); };
      el.onerror = () => { URL.revokeObjectURL(el.src); resolve(NaN); };
      el.src = URL.createObjectURL(file);
    });
    if (Number.isFinite(dur) && dur > MAX_VIDEO_SEC) {
      alert(`That clip is ${Math.round(dur)}s — please keep the Film Room clip under 10 minutes.`);
      return;
    }
    setVideoBusy(true);
    try {
      const ext = (file.name.match(/\.(mp4|mov|webm|m4v|ogg|ogv)$/i)?.[1] || 'mp4').toLowerCase();
      // Ask the server for an upload target: a signed Storage URL on the web
      // (clips can be 500 MB — too big for a Cloud Function body), a local
      // PUT endpoint in dev. Either way: PUT the bytes, then record the name.
      const { filename, url } = await api('/uploads/video-start', { method: 'POST', body: { tradeId: trade.id, ext } });
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type || 'video/mp4' }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      await api(`/trades/${trade.id}/video`, { method: 'POST', body: { video: filename } });
      setVideo(filename);
      onSaved();
    } catch (e) {
      alert('Upload failed: ' + (e.message || 'error'));
    }
    setVideoBusy(false);
  };

  const removeVideo = async () => {
    await api(`/trades/${trade.id}/video`, { method: 'DELETE' });
    setVideo(null);
    onSaved();
  };

  return (
    <>
      <div className="slideover-overlay" onClick={onClose} />
      <div className="slideover trade-slideover">
        <button className="x" onClick={onClose}>✕</button>

        {/* Header — trade facts, always visible */}
        <div className="tp-head">
          <div className="trade-head">
            <span className="sym">{trade.contract}</span>
            <span className="muted">{trade.direction} × {trade.qty}</span>
            <span className={`pnl ${trade.pnl >= 0 ? 'pos' : 'neg'}`}>{money(trade.pnl)}</span>
          </div>
          <div className="trade-sub" style={{ margin: 0 }}>
            {(trade.entry_time || '').replace('T', ' ')} → {(trade.exit_time || '').replace('T', ' ').slice(11)}
            {trade.entry_price != null && <>{' · '}{trade.entry_price} → {trade.exit_price}</>}
            {trade.points != null && ` (${trade.points} pts)`}
            {trade.duration_s != null && <>{' · '}held {fmtDur(trade.duration_s)}</>}
            {trade.source === 'manual' && <span className="tag" style={{ marginLeft: 6 }}>manual</span>}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="tp-body">
          {/* 1 · Film Room review — clip + tags, the primary review step */}
          <Section title="🎬 Film Room review" sub="add a trade clip + tag what happened" defaultOpen>
            <div className="field">
              <label>Trade replay clip — video only, up to 10 min</label>
              {video ? (
                <div className="tp-video">
                  <video src={`/api/videos/${video}`} controls preload="metadata" />
                  <button className="rm" onClick={removeVideo} title="Remove clip">✕</button>
                </div>
              ) : (
                <div
                  className={`shot-add ${videoDrag ? 'over' : ''}`}
                  onClick={() => !videoBusy && videoRef.current.click()}
                  onDragOver={(e) => { e.preventDefault(); setVideoDrag(true); }}
                  onDragLeave={() => setVideoDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setVideoDrag(false); uploadVideo(e.dataTransfer.files?.[0]); }}
                >
                  {videoBusy ? 'Uploading…' : videoDrag ? 'Drop it' : '＋ Add a clip (≤ 10 min)'}
                </div>
              )}
              <input ref={videoRef} type="file" accept="video/*" hidden
                onChange={(e) => { uploadVideo(e.target.files[0]); e.target.value = ''; }} />
            </div>
            <div className="field">
              <label>Direction call — was your read right, regardless of P&L?</label>
              <Pick options={DIRECTION_CALLS} value={dirCall} onChange={setDirCall} />
            </div>
            <div className="field">
              <label>Entry timing</label>
              <Pick options={ENTRY_TIMINGS} value={timing} onChange={setTiming} />
            </div>
            <div className="field">
              <label>Market movement</label>
              <Pick options={MARKET_MOVES} value={move} onChange={setMove} />
            </div>
            <div className="field">
              <label>What drove it?</label>
              <Pick options={INTUITIONS} value={intuition} onChange={setIntuition} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Max favorable move after entry (points)</label>
              <input type="number" step="any" value={mfe} onChange={(e) => setMfe(e.target.value)} placeholder="e.g. 35" />
              {mfe !== '' && trade.points != null && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Captured {Math.abs(trade.points)} pts · left {Math.max(0, Number(mfe) - Math.abs(trade.points)).toFixed(2)} pts on the table
                </div>
              )}
            </div>
          </Section>

          {/* 2 · Trade details — setup + price data (compact) */}
          <Section title="Trade Details">
            {trade.source === 'manual' && (
              <div className="field-row" style={{ marginBottom: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Instrument</label>
                  <select value={product} onChange={(e) => setProduct(e.target.value)}>
                    {['NQ', 'MNQ', 'ES', 'MES'].map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Direction</label>
                  <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                    <option value="long">long</option><option value="short">short</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Contracts</label>
                  <input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
              </div>
            )}
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Setup</label>
              <input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. ORB, VWAP fade, news fade" />
            </div>
            <div className="field-row" style={{ marginBottom: 6 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Stop price (R-multiple)</label>
                <input type="number" step="any" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="e.g. 21890" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Target price (optional)</label>
                <input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 21930" />
              </div>
            </div>
            {stop !== '' && trade.entry_price != null && (
              <div className="muted" style={{ fontSize: 12 }}>
                Risk: {Math.abs(trade.entry_price - Number(stop)).toFixed(2)} pts
                {target !== '' && Number(stop) !== trade.entry_price &&
                  ` · planned R:R ${(Math.abs(Number(target) - trade.entry_price) / Math.abs(trade.entry_price - Number(stop))).toFixed(2)}:1`}
              </div>
            )}
          </Section>

          {/* 3 · Reflection — rating, mistakes, comments */}
          <Section title="Reflection">
            <div className="tp-rating">
              <span className="tp-rating-label">Execution</span>
              <div className="stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={`star ${rating >= n ? 'on' : ''}`}
                    onClick={() => setRating(rating === n ? 0 : n)}>★</span>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>{rating ? RATING_WORD[rating] : 'how well you traded it, not how it paid'}</span>
            </div>

            <div className="field">
              <label>Mistakes</label>
              <div className="chip-row">
                {MISTAKES.map((m) => (
                  <span key={m} className={`tag ${mistakes.includes(m) ? 'on' : ''}`} onClick={() => toggleMistake(m)}>{m}</span>
                ))}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>Comments</label>
              <textarea className="tp-comments" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder={'What was the plan?\nWhat happened?\nNext step?'} />
            </div>
          </Section>
        </div>

        {/* Sticky footer — always reachable without scrolling */}
        <div className="tp-foot">
          <button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
          {trade.source === 'manual' && (
            <button className="ghost" style={{ marginLeft: 'auto', color: 'var(--red)' }}
              onClick={async () => {
                if (!confirm('Delete this manual trade and its clip?')) return;
                await api(`/trades/${trade.id}`, { method: 'DELETE' });
                onSaved(); onClose();
              }}>Delete</button>
          )}
        </div>
      </div>
    </>
  );
}
