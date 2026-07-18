import React, { useEffect, useState } from 'react';
import { api, money, fmt } from '../api.js';

const STATUS = {
  passed: { label: 'PASSED', color: 'var(--green)' },
  progress: { label: 'IN PROGRESS', color: '#f59e0b' },
  failed: { label: 'BLOWN', color: 'var(--red)' },
};

const badgeBg = (color) =>
  color === 'var(--green)' ? 'rgba(22,163,74,0.14)'
    : color === 'var(--red)' ? 'rgba(220,38,38,0.14)'
    : 'rgba(245,158,11,0.16)';

function AccountCard({ a, onOpen, onDelete }) {
  const s = STATUS[a.status] || STATUS.progress;
  return (
    <div className="acct-card" onClick={() => onOpen(a.id)}>
      <div className="row" style={{ marginBottom: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{a.name}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {a.firm ? `${a.firm} · ` : ''}${(a.startBalance / 1000).toFixed(0)}K {a.phase === 'funded' ? 'funded' : 'eval'}
          </div>
        </div>
        <div className="spacer" />
        <span style={{
          fontWeight: 800, fontSize: 10, letterSpacing: 0.5, padding: '4px 11px', borderRadius: 999,
          background: badgeBg(s.color), color: s.color, whiteSpace: 'nowrap',
        }}>{s.label}</span>
        <button className="acct-del" title="Delete account" style={{ marginLeft: 8 }}
          onClick={(e) => { e.stopPropagation(); onDelete(a); }}>🗑</button>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="stat-label">Equity</div>
          <div style={{ fontWeight: 800, fontSize: 22 }}>{money(a.equity)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stat-label">Net P&L</div>
          <div className={a.profit >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 800, fontSize: 22 }}>{money(a.profit)}</div>
        </div>
      </div>

      {a.phase !== 'funded' && a.target > 0 ? (
        <>
          <div className="acct-bar" style={{ height: 10 }}>
            <div style={{ width: `${Math.min(100, a.targetPct || 0)}%`, background: a.status === 'passed' ? 'var(--green)' : 'var(--accent)' }} />
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            {a.status === 'passed' ? `Target hit${a.passedOn ? ` ${a.passedOn}` : ''}` : `${money(a.profit)} / ${money(a.target)} target`}
          </div>
        </>
      ) : (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {a.payoutsTaken != null && `${a.payoutsTaken} payouts · `}{a.payoutEligible ? 'payout eligible' : 'building'}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        {a.breachedOn ? <span className="neg">Blown {a.breachedOn}</span>
          : <>Room to floor: <b className={a.distance < a.startBalance * 0.01 ? 'neg' : ''}>{money(a.distance)}</b></>}
        {' · '}{a.tradingDays} days
      </div>
    </div>
  );
}

export default function Portfolio({ dataVersion, onOpen, onAdd, onDelete, filter }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/overview').then(setRows); }, [dataVersion]);
  if (!rows) return null;

  const isFunded = filter === 'funded';
  const title = isFunded ? 'Funded Accounts (PA)' : 'Challenges';
  // Challenges shows only ACTIVE, in-progress evals — passed/blown ones move to
  // the Archive (via the Passed/Blown buttons on the dashboard).
  const list = rows.filter((a) => (isFunded
    ? a.phase === 'funded'
    : a.phase !== 'funded' && a.status === 'progress'));
  const totalEquity = list.reduce((s, a) => s + a.equity, 0);
  const totalPnl = list.reduce((s, a) => s + a.profit, 0);

  return (
    <>
      {list.length > 0 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <div className="spacer" />
          <><span className="muted">Equity {money(totalEquity)} · </span>
            <span className={totalPnl >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{money(totalPnl)}</span></>
        </div>
      )}
      {list.length === 0 ? (
        <div style={{ maxWidth: 720, margin: '5vh auto 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l5-5 4 3 7-8" /><path d="M16 4h5v5" />
            </svg>
            <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}>
              {isFunded ? 'Welcome to funded accounts' : 'Welcome to challenges'}
            </h1>
          </div>
          <p className="muted" style={{ fontSize: 15, marginTop: 0, lineHeight: 1.6 }}>
            {isFunded
              ? 'Create your first funded account to start tracking your funded journey.'
              : 'Create your first challenge to begin tracking your evaluation account.'}
          </p>

          <div className="panel" style={{ marginTop: 18 }}>
            <h2>{isFunded ? 'How funded accounts work' : 'How challenges work'}</h2>
            <ol className="welcome-steps">
              <li><b>Create an account.</b> {isFunded ? 'Start a funded account and keep all payout details in one place.' : 'Create a challenge and let the app track your target, drawdown, and payout progress.'}</li>
              <li><b>Import your trades.</b> Drop in your Tradovate CSV and the app will calculate your current status automatically.</li>
              <li><b>Track your progress.</b> Watch your growth curve, trailing drawdown, consistency, and payout eligibility as you go.</li>
            </ol>
          </div>

          <div className="row" style={{ marginTop: 20, gap: 12 }}>
            <button onClick={() => onAdd(isFunded ? 'funded' : 'eval')} style={{ padding: '11px 18px', fontSize: 15 }}>
              ＋ New {isFunded ? 'Funded Account' : 'Challenge'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {list.map((a) => <AccountCard key={a.id} a={a} onOpen={onOpen} onDelete={onDelete} />)}
        </div>
      )}
    </>
  );
}
