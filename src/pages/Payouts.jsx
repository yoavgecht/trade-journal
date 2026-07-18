import React, { useEffect, useState } from 'react';
import { api, money } from '../api.js';

const fmtDate = (s) => (s
  ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  : '—');

// Ledger of every payout the user has taken, across all funded accounts. Record
// a payout from a funded account's dashboard (💸 Take Payout); they show here.
export default function Payouts({ dataVersion }) {
  const [rows, setRows] = useState(null);
  const [v, setV] = useState(0);
  useEffect(() => { api('/payouts-all').then(setRows); }, [dataVersion, v]);
  if (!rows) return null;

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const byFirm = {};
  for (const r of rows) {
    const f = r.firm || 'Other';
    (byFirm[f] ??= { firm: f, count: 0, amount: 0 });
    byFirm[f].count++;
    byFirm[f].amount += r.amount || 0;
  }
  const firms = Object.values(byFirm).sort((a, b) => b.amount - a.amount);

  const remove = async (id) => {
    if (!confirm('Remove this payout from the ledger?')) return;
    await api(`/payouts/${id}`, { method: 'DELETE' });
    setV((x) => x + 1);
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Payouts</h1>
        <div className="spacer" />
        <span className="muted">Total received</span>
        <span className="pos" style={{ fontWeight: 800, fontSize: 22, marginLeft: 10 }}>{money(total)}</span>
      </div>

      {/* Per-firm summary tiles */}
      {firms.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, firms.length)}, 1fr)`, gap: 16, marginBottom: 16 }}>
          {firms.map((f) => (
            <div className="panel" key={f.firm}>
              <div className="stat-label">{f.firm}</div>
              <div className="stat-value pos">{money(f.amount)}</div>
              <div className="muted" style={{ fontSize: 12 }}>{f.count} payout{f.count !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        {rows.length === 0 ? (
          <div className="muted">No payouts yet — take one from a funded account's dashboard (💸 Take Payout) and it'll show here.</div>
        ) : (
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Date</th>
                <th style={{ textAlign: 'left' }}>Account</th>
                <th style={{ textAlign: 'left' }}>Firm</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.account}{r.note ? <span className="muted"> · {r.note}</span> : null}</td>
                  <td>{r.firm || '—'}</td>
                  <td className="pos" style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.amount)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => remove(r.id)}>remove</button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}><b>Total</b></td>
                <td className="pos" style={{ textAlign: 'right' }}><b>{money(total)}</b></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
