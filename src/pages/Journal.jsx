import React, { useEffect, useRef, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, YAxis, ReferenceLine } from 'recharts';
import { api, money, fmt } from '../api.js';

function DayCurve({ points }) {
  if (!points || points.length < 2) return <div className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>—</div>;
  const up = points[points.length - 1].cum >= 0;
  return (
    <ResponsiveContainer width="100%" height={90}>
      <AreaChart data={points} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id="dayfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? '#16a34a' : '#dc2626'} stopOpacity={0.3} />
            <stop offset="100%" stopColor={up ? '#16a34a' : '#dc2626'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['auto', 'auto']} />
        <ReferenceLine y={0} stroke="#d1d5db" />
        <Area type="monotone" dataKey="cum" stroke={up ? '#16a34a' : '#dc2626'} strokeWidth={2} fill="url(#dayfill)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Stat({ label, value, cls }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={cls} style={{ fontWeight: 700, fontSize: 15 }}>{value}</div>
    </div>
  );
}

// Daily log modal — the day's stats + a free-text journal note.
function DailyLog({ day, onClose, onSaved }) {
  const [note, setNote] = useState(day.note || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await api(`/day-log/${day.date}`, { method: 'PUT', body: { note } });
    setSaving(false);
    onSaved();
    onClose();
  };
  const title = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose}>✕</button>
        <h3>Daily log</h3>
        <div className="trade-head"><span className="sym">{title}</span>
          <span className={`pnl ${day.net >= 0 ? 'pos' : 'neg'}`}>{money(day.net)}</span></div>
        <div style={{ height: 110, margin: '6px 0 12px' }}><DayCurve points={day.points} /></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <Stat label="Total trades" value={day.trades} />
          <Stat label="Winners" value={day.winners} cls="pos" />
          <Stat label="Losers" value={day.losers} cls="neg" />
          <Stat label="Win rate" value={day.winRate == null ? '—' : `${fmt(day.winRate)}%`} />
          <Stat label="Gross P&L" value={money(day.gross)} cls={day.gross >= 0 ? 'pos' : 'neg'} />
          <Stat label="Commissions" value={money(day.fees)} />
          <Stat label="Volume" value={day.volume} />
          <Stat label="Profit factor" value={day.profitFactor == null ? '—' : fmt(day.profitFactor)} />
        </div>
        <label className="stat-label">Journal note</label>
        <textarea rows={8} value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 4 }}
          placeholder={'How did the day go? Did you follow your plan?\nWhat worked, what didn’t, what to fix tomorrow.'} />
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save log'}</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function Journal({ dataVersion }) {
  const [days, setDays] = useState(null);
  const [open, setOpen] = useState(null);
  const [v, setV] = useState(0);
  useEffect(() => { api('/journal').then(setDays); }, [dataVersion, v]);
  if (!days) return null;

  return (
    <>
      <h1>Daily Journal</h1>
      {days.length === 0 && <div className="panel muted">No trading days yet — import trades or add a manual day.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {days.map((d) => (
          <div key={d.date} className="panel" style={{ cursor: 'pointer' }} onClick={() => setOpen(d)}>
            <div className="row" style={{ marginBottom: 10 }}>
              <b>{new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b>
              <span className={`${d.net >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>· {money(d.net)}</span>
              {d.note && <span title="has a note">📝</span>}
              <div className="spacer" />
              <span className="muted" style={{ fontSize: 12 }}>Daily log ›</span>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 220, flexShrink: 0 }}><DayCurve points={d.points} /></div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, flex: 1 }}>
                <Stat label="Total trades" value={d.trades} />
                <Stat label="Winners" value={d.winners} cls="pos" />
                <Stat label="Gross P&L" value={money(d.gross)} cls={d.gross >= 0 ? 'pos' : 'neg'} />
                <Stat label="Commissions" value={money(d.fees)} />
                <Stat label="Win rate" value={d.winRate == null ? '—' : `${fmt(d.winRate)}%`} />
                <Stat label="Losers" value={d.losers} cls="neg" />
                <Stat label="Volume" value={d.volume} />
                <Stat label="Profit factor" value={d.profitFactor == null ? '—' : fmt(d.profitFactor)} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {open && <DailyLog day={open} onClose={() => setOpen(null)} onSaved={() => setV((x) => x + 1)} />}
    </>
  );
}
