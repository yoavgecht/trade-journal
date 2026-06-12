import React, { useEffect, useState } from 'react';
import { api, money } from '../api.js';
import TradePanel, { parseJsonArr, fmtDur } from '../components/TradePanel.jsx';

export default function Trades({ dataVersion }) {
  const [trades, setTrades] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
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
        <span className="muted">Click a trade to add comments, rate the execution, and attach screenshots.</span>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Closed</th><th>Contract</th><th>Dir</th><th>Qty</th><th>Entry → Exit</th><th>Held</th><th>P&L</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const nShots = parseJsonArr(t.screenshots).length;
              const tags = parseJsonArr(t.mistakes);
              return (
                <tr key={t.id} onClick={() => setSelected(t)} style={{ cursor: 'pointer' }}>
                  <td>{(t.exit_time || '').replace('T', ' ').slice(0, 16)}</td>
                  <td>{t.contract}</td>
                  <td>{t.direction}</td>
                  <td>{t.qty}</td>
                  <td>{t.entry_price} → {t.exit_price}</td>
                  <td>{fmtDur(t.duration_s)}</td>
                  <td className={t.pnl >= 0 ? 'pos' : 'neg'}>{money(t.pnl)}</td>
                  <td>
                    {t.rating ? <span style={{ color: '#f59e0b' }}>{'★'.repeat(t.rating)}</span> : null}
                    {tags.map((m) => <span key={m} className="tag on">{m}</span>)}
                    {t.setup && <span className="tag">{t.setup}</span>}
                    {t.notes && ' 📝'}{nShots > 0 && ` 📷${nShots}`}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={8} className="muted">No trades.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && (
        <TradePanel trade={selected} onClose={() => setSelected(null)} onSaved={() => setV((x) => x + 1)} />
      )}
    </>
  );
}
