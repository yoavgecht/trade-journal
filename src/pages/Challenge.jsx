import React, { useEffect, useState } from 'react';
import { api, money, fmt } from '../api.js';

function Bar({ pct, color }) {
  return (
    <div style={{ height: 10, borderRadius: 5, background: 'var(--panel2)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color }} />
    </div>
  );
}

function Check({ ok, children }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 16, lineHeight: '20px' }}>{ok ? '✅' : '⬜'}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export default function Challenge({ dataVersion, journal }) {
  const [c, setC] = useState(null);
  useEffect(() => { api('/challenge').then(setC); }, [dataVersion, journal.id]);
  if (!c) return null;

  const statusColor = c.status === 'passed' ? 'var(--green)' : c.status === 'failed' ? 'var(--red)' : '#f59e0b';
  const statusLabel = c.status === 'passed' ? (c.phase === 'funded' ? 'PAYOUT READY' : 'PASSED')
    : c.status === 'failed' ? 'BLOWN' : 'IN PROGRESS';
  const ddPct = c.drawdown.trailingDd > 0 ? (c.drawdown.distance / c.drawdown.trailingDd) * 100 : 0;
  const ddColor = ddPct < 35 ? 'var(--red)' : ddPct < 60 ? '#f59e0b' : 'var(--green)';

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Challenge — {journal.name}</h1>
        {c.firm && <span className="market-chip">{c.firm} · {c.phase}</span>}
        <div className="spacer" />
        <span style={{ fontWeight: 800, fontSize: 15, color: statusColor }}>{statusLabel}</span>
      </div>

      <div className="panel" style={{ borderLeft: `4px solid ${statusColor}`, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.headline}</div>
      </div>

      {/* Top numbers */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        <div className="panel">
          <div className="stat-label">Profit so far</div>
          <div className={`stat-value ${c.profit >= 0 ? 'pos' : 'neg'}`}>{money(c.profit)}</div>
          <div className="muted" style={{ fontSize: 12 }}>{c.tradingDays} trading days</div>
        </div>
        <div className="panel">
          <div className="stat-label">Distance to blowout</div>
          <div className="stat-value" style={{ color: ddColor }}>{money(c.drawdown.distance)}</div>
          <div className="muted" style={{ fontSize: 12 }}>closest ever: {money(c.drawdown.minDistance)}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Safe to lose TODAY</div>
          <div className="stat-value">{money(c.roomToday)}</div>
          <div className="muted" style={{ fontSize: 12 }}>{c.dailyLossLimit > 0 ? `min(drawdown, ${money(c.dailyLossLimit)} DLL)` : 'to the trailing threshold'}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Trailing threshold</div>
          <div className="stat-value">{money(c.drawdown.threshold)}</div>
          <div className="muted" style={{ fontSize: 12 }}>max drawdown {money(c.drawdown.trailingDd)}</div>
        </div>
      </div>

      {/* Requirements checklist */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>What it takes {c.phase === 'funded' ? 'to get paid' : 'to pass'}</h2>

        {c.target > 0 && (
          <Check ok={c.targetMet}>
            <div className="row">
              <b>Profit target</b><div className="spacer" />
              <span>{money(c.profit)} / {money(c.target)}</span>
            </div>
            <Bar pct={c.targetPct} color={c.targetMet ? 'var(--green)' : 'var(--accent)'} />
            {!c.targetMet && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{money(c.targetRemaining)} to go</div>}
          </Check>
        )}

        <Check ok={!c.drawdown.breachedOn}>
          <div className="row">
            <b>Stay above trailing drawdown</b><div className="spacer" />
            <span>{c.drawdown.breachedOn ? `breached ${c.drawdown.breachedOn}` : `${money(c.drawdown.distance)} of room`}</span>
          </div>
          <Bar pct={ddPct} color={ddColor} />
        </Check>

        {c.consistency && (
          <Check ok={c.consistency.compliant}>
            <div className="row">
              <b>Consistency — biggest day ≤ {c.consistency.pct}% of total profit</b><div className="spacer" />
              <span>biggest day is {fmt(c.consistency.bestDayShare)}% ({money(c.consistency.bestDay)})</span>
            </div>
            <Bar pct={(c.consistency.effectivePct / Math.max(c.consistency.bestDayShare, c.consistency.effectivePct)) * 100}
              color={c.consistency.compliant ? 'var(--green)' : 'var(--red)'} />
            {!c.consistency.compliant && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                ⚠️ Your biggest day is too large a share. You need <b>{money(c.consistency.additionalNeeded)}</b> more
                profit on OTHER days (total ≥ {money(c.consistency.requiredTotal)}) before this complies.
              </div>
            )}
            {c.consistency.compliant && c.consistency.maxDayAtTarget != null && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                At the {money(c.target)} target, keep any single day under <b>{money(c.consistency.maxDayAtTarget)}</b>
                {c.consistency.cushionPct > 0
                  ? ` (${c.consistency.pct}% + ${c.consistency.cushionPct}% cushion = ${c.consistency.effectivePct}% of target).`
                  : '.'}
              </div>
            )}
          </Check>
        )}

        {c.qualifying && (
          <Check ok={c.qualifying.met}>
            <div className="row">
              <b>Qualifying days (≥ {money(c.qualifying.amount)} each)</b><div className="spacer" />
              <span>{c.qualifying.have} / {c.qualifying.need}</span>
            </div>
            <Bar pct={(c.qualifying.have / c.qualifying.need) * 100} color={c.qualifying.met ? 'var(--green)' : 'var(--accent)'} />
            {!c.qualifying.met && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{c.qualifying.remaining} more day(s) of {money(c.qualifying.amount)}+</div>}
          </Check>
        )}

        {c.dailyLossLimit > 0 && (
          <Check ok={c.dllBreaches === 0}>
            <div className="row">
              <b>Respect the daily loss limit ({money(c.dailyLossLimit)})</b><div className="spacer" />
              <span>{c.dllBreaches === 0 ? 'clean' : `${c.dllBreaches} day(s) over`}</span>
            </div>
          </Check>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12 }}>
        Day-granularity from imported trades + manual days. Drawdown is simulated end-of-day (intraday swings between
        fills aren't visible). Rules come from this journal's settings — keep them matched to your firm.
      </div>
    </>
  );
}
