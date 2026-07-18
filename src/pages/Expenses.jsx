import React, { useEffect, useState } from 'react';
import { api, money } from '../api.js';

const fmtDate = (s) => (s
  ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  : '—');

// What every account (active + archived) cost — so the trader can see how much
// they've spent on evaluations + activation fees, per firm and in total.
export default function Expenses({ dataVersion }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/expenses').then(setRows); }, [dataVersion]);
  if (!rows) return null;

  // Only challenges carry a cost (the total incl. activation fee); funded
  // accounts are earned by passing, not purchased.
  const items = rows.filter((r) => r.phase !== 'funded');
  const total = items.reduce((s, r) => s + (r.cost || 0), 0);

  // Per-firm subtotals (Apex / Lucid / …).
  const byFirm = {};
  for (const r of items) {
    const f = r.firm || 'Other';
    (byFirm[f] ??= { firm: f, count: 0, cost: 0 });
    byFirm[f].count++;
    byFirm[f].cost += r.cost || 0;
  }
  const firms = Object.values(byFirm).sort((a, b) => b.cost - a.cost);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Expenses</h1>
        <div className="spacer" />
        <span className="muted">Total spent on accounts</span>
        <span style={{ fontWeight: 800, fontSize: 22, marginLeft: 10 }}>{money(total)}</span>
      </div>

      {/* Per-firm summary tiles */}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, firms.length)}, 1fr)`, gap: 16, marginBottom: 16 }}>
        {firms.map((f) => (
          <div className="panel" key={f.firm}>
            <div className="stat-label">{f.firm}</div>
            <div className="stat-value">{money(f.cost)}</div>
            <div className="muted" style={{ fontSize: 12 }}>{f.count} account{f.count !== 1 ? 's' : ''}</div>
          </div>
        ))}
      </div>

      {/* Line items */}
      <div className="panel">
        {items.length === 0 ? (
          <div className="muted">No challenges yet — costs you enter when creating a challenge show up here.</div>
        ) : (
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Prop firm</th>
                <th style={{ textAlign: 'left' }}>Challenge</th>
                <th style={{ textAlign: 'left' }}>Date created</th>
                <th style={{ textAlign: 'right' }}>Total cost</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td>{r.firm || '—'}</td>
                  <td>{r.name}{r.archived ? <span className="muted"> · {r.outcome}</span> : null}</td>
                  <td>{fmtDate(r.date)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.cost ? money(r.cost) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}><b>Total</b></td>
                <td style={{ textAlign: 'right' }}><b>{money(total)}</b></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
