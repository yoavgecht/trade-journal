import React, { useEffect, useState } from 'react';
import { api, money, fmt } from '../api.js';

function Stat({ label, value, cls }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={cls} style={{ fontWeight: 700, fontSize: 15 }}>{value}</div>
    </div>
  );
}

// Passed / blown accounts, kept forever for records + taxes. Data is never
// deleted — a blown challenge is a deductible business expense you can show.
export default function Archive({ onView, onDelete }) {
  const [rows, setRows] = useState(null);
  const load = () => api('/journals/archived').then(setRows);
  useEffect(() => { load(); }, []);
  if (!rows) return null;

  const del = async (j) => {
    const ok = await onDelete?.(j); // confirms + deletes account + its clips/screenshots
    if (ok) setRows((rs) => rs.filter((x) => x.id !== j.id));
  };

  return (
    <>
      <h1>Archive</h1>
      <p className="muted" style={{ marginTop: -6, marginBottom: 16 }}>
        Passed and blown accounts, kept permanently for your records — a blown challenge fee is a deductible expense.
      </p>

      {rows.length === 0 && (
        <div className="panel muted">No archived accounts yet. Pass or blow a challenge and it lands here.</div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {rows.map((j) => {
          const passed = j.outcome === 'passed';
          const color = passed ? 'var(--green)' : 'var(--red)';
          return (
            <div key={j.id} className="panel" style={{ borderLeft: `4px solid ${color}` }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{j.name}</div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span style={{
                    fontWeight: 800, fontSize: 11, letterSpacing: 0.5, padding: '3px 10px', borderRadius: 999,
                    background: passed ? 'rgba(22,163,74,0.14)' : 'rgba(220,38,38,0.14)', color,
                  }}>{passed ? 'PASSED' : 'BLOWN'}</span>
                  <button className="archive-del" title="Delete this account permanently"
                    onClick={() => del(j)}>✕</button>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {j.firm ? `${j.firm} · ` : ''}${(j.start_balance / 1000).toFixed(0)}K {j.phase === 'funded' ? 'funded' : 'eval'}
                {j.archived_at ? ` · archived ${j.archived_at.slice(0, 10)}` : ''}
              </div>

              <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
                <Stat label="Net P&L" value={money(j.totalPnl)} cls={j.totalPnl >= 0 ? 'pos' : 'neg'} />
                <Stat label="Trades" value={j.trades} />
                <Stat label="Win rate" value={j.winRate == null ? '—' : `${fmt(j.winRate)}%`} />
                <Stat label="Profit factor" value={j.profitFactor == null ? '—' : fmt(j.profitFactor)} />
              </div>

              <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
                {j.firstDay && j.lastDay ? `${j.firstDay} → ${j.lastDay}` : 'no trades recorded'}
              </div>

              <button className="ghost" style={{ marginTop: 12, width: '100%' }} onClick={() => onView?.(j)}>
                View full dashboard →
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
