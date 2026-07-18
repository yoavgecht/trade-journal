import React, { useEffect, useState } from 'react';
import { api, money } from '../api.js';
import TradePanel, { parseJsonArr, fmtDur } from '../components/TradePanel.jsx';

// "Jan 08, 6:39:16 PM" — entry/exit times are stored timezone-naive, so they
// render in the trade's own clock (no shifting).
const fmtDT = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
};
const px = (p) => (p == null ? '—' : `$${+p}`); // strip trailing .0 via Number coercion

function BiasBadge({ dir }) {
  const long = String(dir).toLowerCase() === 'long';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800,
      letterSpacing: 0.4,
      background: long ? 'rgba(37,99,235,0.12)' : 'rgba(220,38,38,0.12)',
      color: long ? '#2563eb' : '#dc2626',
    }}>{long ? 'LONG' : 'SHORT'}</span>
  );
}

// Closed-trades table for the Dashboard (sits under the calendar). Scoped to the
// active account by the /trades endpoint, so each challenge / funded account
// shows only its own trades. Click a row to open the trade detail panel.
export default function ClosedTrades({ dataVersion, journal }) {
  const [trades, setTrades] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [v, setV] = useState(0);
  useEffect(() => { api('/trades').then(setTrades); }, [dataVersion, journal.id, v]);

  const shown = trades.filter((t) =>
    filter === 'all' ? true : filter === 'wins' ? t.pnl > 0 : filter === 'losses' ? t.pnl < 0 : true);
  const shownPnl = shown.reduce((s, t) => s + t.pnl, 0);

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="ad-title"><span className="ad-accent" />Closed Trades</div>
        <span className="muted" style={{ fontSize: 12 }}>{trades.length} trade{trades.length !== 1 ? 's' : ''} · click a row to review</span>
        <div className="spacer" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: '5px 10px' }}>
          <option value="all">All ({trades.length})</option>
          <option value="wins">Wins</option>
          <option value="losses">Losses</option>
        </select>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ maxHeight: 540, overflowY: 'auto' }}>
          <table className="trades-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th>Open Time</th>
                <th style={{ textAlign: 'right' }}>Avg Entry</th>
                <th style={{ textAlign: 'center' }}>Bias</th>
                <th>Duration</th>
                <th>Close Time</th>
                <th style={{ textAlign: 'right' }}>Avg Close</th>
                <th style={{ textAlign: 'right' }}>Profit</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const nShots = parseJsonArr(t.screenshots).length;
                const tags = parseJsonArr(t.mistakes);
                const win = t.pnl >= 0;
                return (
                  <tr key={t.id} onClick={() => setSelected(t)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 700 }}>
                      {t.contract || t.product}
                      {t.rating ? <span style={{ color: '#f59e0b', marginLeft: 6 }}>{'★'.repeat(t.rating)}</span> : null}
                      {t.notes ? <span title="has notes" style={{ marginLeft: 4 }}>📝</span> : null}
                      {nShots > 0 ? <span title={`${nShots} screenshot(s)`} style={{ marginLeft: 4 }}>📷{nShots}</span> : null}
                      {tags.map((m) => <span key={m} className="tag on" style={{ marginLeft: 4 }}>{m}</span>)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{t.qty}</td>
                    <td className="muted">{fmtDT(t.entry_time)}</td>
                    <td style={{ textAlign: 'right' }}>{px(t.entry_price)}</td>
                    <td style={{ textAlign: 'center' }}><BiasBadge dir={t.direction} /></td>
                    <td className="muted">{fmtDur(t.duration_s)}</td>
                    <td className="muted">{fmtDT(t.exit_time)}</td>
                    <td style={{ textAlign: 'right' }}>{px(t.exit_price)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: win ? 'var(--green)' : 'var(--red)' }}>
                      {win ? '+' : ''}{money(t.pnl)}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={9} className="muted" style={{ padding: 16 }}>No trades.</td></tr>}
            </tbody>
          </table>
        </div>
        {shown.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 13,
          }}>
            <span className="muted">{shown.length} shown</span>
            <span>Total P&amp;L:&nbsp;
              <strong style={{ color: shownPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {shownPnl >= 0 ? '+' : ''}{money(shownPnl)}
              </strong>
            </span>
          </div>
        )}
      </div>

      {selected && (
        <TradePanel trade={selected} onClose={() => setSelected(null)} onSaved={() => setV((x) => x + 1)} />
      )}
    </>
  );
}
