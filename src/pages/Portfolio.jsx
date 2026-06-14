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

export default function Portfolio({ dataVersion, onOpen, onAdd, filter }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/overview').then(setRows); }, [dataVersion]);
  if (!rows) return null;

  const isFunded = filter === 'funded';
  const title = isFunded ? 'Funded Accounts (PA)' : 'Challenges';
  const list = rows.filter((a) => (isFunded ? a.phase === 'funded' : a.phase !== 'funded'));
  const totalEquity = list.reduce((s, a) => s + a.equity, 0);
  const totalPnl = list.reduce((s, a) => s + a.profit, 0);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <button className="ghost" style={{ padding: '5px 12px' }} onClick={() => onAdd(isFunded ? 'funded' : 'eval')}>
          ＋ New {isFunded ? 'Funded Account' : 'Challenge'}
        </button>
        <div className="spacer" />
        {list.length > 0 && <><span className="muted">Equity {money(totalEquity)} · </span>
          <span className={totalPnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{money(totalPnl)}</span></>}
      </div>
      {list.length === 0 ? (
        <div className="panel muted">No {isFunded ? 'funded accounts' : 'challenges'} yet — click “New” to add one.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {list.map((a) => <AccountCard key={a.id} a={a} onOpen={onOpen} />)}
        </div>
      )}
    </>
  );
}
