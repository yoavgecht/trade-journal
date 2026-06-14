import React, { useEffect, useState } from 'react';
import { api, money, fmt } from '../api.js';

const STATUS = {
  passed: { label: 'PASSED', color: 'var(--green)' },
  progress: { label: 'IN PROGRESS', color: '#f59e0b' },
  failed: { label: 'BLOWN', color: 'var(--red)' },
};

function AccountCard({ a, onOpen }) {
  const s = STATUS[a.status] || STATUS.progress;
  return (
    <div className="acct-card" onClick={() => onOpen(a.id)}>
      <div className="row" style={{ marginBottom: 6 }}>
        <b style={{ fontSize: 14 }}>{a.name}</b>
        <div className="spacer" />
        <span style={{ fontWeight: 800, fontSize: 11, color: s.color }}>{s.label}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div className="stat-label">Equity</div>
          <div style={{ fontWeight: 700 }}>{money(a.equity)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-label">Net P&L</div>
          <div className={`${a.profit >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>{money(a.profit)}</div>
        </div>
      </div>
      {/* target progress (eval) or distance (funded) */}
      {a.phase !== 'funded' && a.target > 0 ? (
        <>
          <div className="acct-bar"><div style={{ width: `${a.targetPct || 0}%`, background: a.status === 'passed' ? 'var(--green)' : 'var(--accent)' }} /></div>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            {a.status === 'passed' ? `Target hit${a.passedOn ? ` ${a.passedOn}` : ''}` : `${money(a.profit)} / ${money(a.target)} target`}
          </div>
        </>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>
          {a.payoutsTaken != null && `${a.payoutsTaken} payouts · `}{a.payoutEligible ? 'payout eligible' : 'building'}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {a.breachedOn ? <span className="neg">Blown {a.breachedOn}</span>
          : <>Room to floor: <b className={a.distance < a.startBalance * 0.01 ? 'neg' : ''}>{money(a.distance)}</b></>}
        {' · '}{a.tradingDays} days
      </div>
    </div>
  );
}

export default function Portfolio({ dataVersion, onOpen, onAdd }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/overview').then(setRows); }, [dataVersion]);
  if (!rows) return null;

  const groups = [['Challenges', rows.filter((a) => a.phase !== 'funded')], ['Funded (PA)', rows.filter((a) => a.phase === 'funded')]];
  const totalEquity = rows.reduce((s, a) => s + a.equity, 0);
  const totalPnl = rows.reduce((s, a) => s + a.profit, 0);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Accounts</h1>
        <div className="spacer" />
        <span className="muted">Total equity {money(totalEquity)} · </span>
        <span className={totalPnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{money(totalPnl)}</span>
      </div>

      {groups.map(([title, list]) => (
        <div key={title} style={{ marginBottom: 18 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{title} ({list.length})</h2>
            <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => onAdd(title === 'Funded (PA)' ? 'funded' : 'eval')}>＋ Add</button>
          </div>
          {list.length === 0 ? (
            <div className="panel muted">No {title.toLowerCase()} yet.</div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {list.map((a) => <AccountCard key={a.id} a={a} onOpen={onOpen} />)}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
