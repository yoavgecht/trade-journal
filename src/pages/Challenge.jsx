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

export default function Challenge({ dataVersion, journal, embedded }) {
  const [c, setC] = useState(null);
  const [v, setV] = useState(0);
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAmt, setPayAmt] = useState('');
  useEffect(() => { api('/challenge').then(setC); }, [dataVersion, journal.id, v]);
  if (!c) return null;

  const logPayout = async () => {
    const amount = parseFloat(payAmt);
    if (Number.isNaN(amount)) return;
    await api('/payouts', { method: 'POST', body: { date: payDate, amount, note: null } });
    setPayAmt('');
    setV((x) => x + 1);
  };
  const removePayout = async (pid) => { await api(`/payouts/${pid}`, { method: 'DELETE' }); setV((x) => x + 1); };

  const statusColor = c.status === 'passed' ? 'var(--green)' : c.status === 'failed' ? 'var(--red)' : '#f59e0b';
  const statusLabel = c.status === 'passed' ? (c.phase === 'funded' ? 'PAYOUT READY' : 'PASSED')
    : c.status === 'failed' ? 'BLOWN' : 'IN PROGRESS';
  const ddPct = c.drawdown.trailingDd > 0 ? (c.drawdown.distance / c.drawdown.trailingDd) * 100 : 0;
  const ddColor = ddPct < 35 ? 'var(--red)' : ddPct < 60 ? '#f59e0b' : 'var(--green)';

  return (
    <>
      {!embedded && (
        <div className="row" style={{ marginBottom: 14 }}>
          <h1 style={{ margin: 0 }}>Challenge — {journal.name}</h1>
          {c.firm && <span className="market-chip">{c.firm} · {c.phase}</span>}
          <div className="spacer" />
          <span style={{ fontWeight: 800, fontSize: 15, color: statusColor }}>{statusLabel}</span>
        </div>
      )}

      <div className="panel" style={{ borderLeft: `4px solid ${statusColor}`, marginBottom: 14 }}>
        <div className="row">
          <div style={{ fontWeight: 700, fontSize: 15 }}>{c.headline}</div>
          {embedded && <><div className="spacer" /><span style={{ fontWeight: 800, fontSize: 13, color: statusColor }}>{statusLabel}</span></>}
        </div>
        {c.passedOn && (
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            🎯 Hit the {money(c.target)} target on <b>{new Date(c.passedOn + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b> at {money(c.profitAtPass)} — the eval ends here; you move to a funded account (PA).
            {c.daysAfterPass > 0 && <> Your {c.daysAfterPass} day(s) of trading after that wouldn't be on this eval (they'd belong to the PA).</>}
          </div>
        )}
      </div>

      {/* Top numbers — hidden when embedded on the Dashboard (the growth blocks
          already show profit/equity/distance); only "safe to lose today" is unique. */}
      {!embedded ? (
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
          <div className="stat-value" style={{ color: c.roomToday < (c.dailyLossLimit || c.drawdown.trailingDd) * 0.35 ? 'var(--red)' : undefined }}>{money(c.roomToday)}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {c.todayPnl !== 0 && <>today so far: <span className={c.todayPnl >= 0 ? 'pos' : 'neg'}>{money(c.todayPnl)}</span> · </>}
            {c.dailyLossLimit > 0 ? `${money(c.dailyLossLimit)} daily limit` : 'to trailing threshold'}
          </div>
        </div>
        <div className="panel">
          <div className="stat-label">Trailing threshold</div>
          <div className="stat-value">{money(c.drawdown.threshold)}</div>
          <div className="muted" style={{ fontSize: 12 }}>max drawdown {money(c.drawdown.trailingDd)}</div>
        </div>
      </div>
      ) : (() => {
        const low = c.drawdown.distance < c.drawdown.trailingDd * 0.35;
        return (
          <div className="panel" style={{ marginBottom: 14, borderLeft: `4px solid ${low ? 'var(--red)' : '#f59e0b'}` }}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div>
                <div className="stat-label">⚠️ Minimum balance — don't go below this</div>
                <div className="stat-value">{money(c.drawdown.threshold)}</div>
              </div>
              <div className="spacer" />
              <div style={{ textAlign: 'right' }}>
                <div className="stat-label">Room above it</div>
                <div className="stat-value" style={{ color: low ? 'var(--red)' : undefined }}>{money(c.drawdown.distance)}</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Balance {money(c.drawdown.threshold + c.drawdown.distance)} — you have {money(c.drawdown.distance)} before the trailing stop liquidates the account.
              {c.dailyLossLimit > 0 && <> Daily loss limit: {money(c.dailyLossLimit)}.</>}
            </div>
          </div>
        );
      })()}

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

      {/* Payout center (funded phase) */}
      {c.payout && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Payout center</h2>
            <div className="spacer" />
            {c.payout.movedLive
              ? <span style={{ fontWeight: 800, color: 'var(--green)' }}>🎓 MOVED LIVE — {c.payout.taken} payouts taken</span>
              : <span style={{ fontWeight: 700, color: c.payout.eligible ? 'var(--green)' : 'var(--muted)' }}>
                  {c.payout.eligible ? '✅ Eligible to request a payout' : 'Not yet eligible'}
                </span>}
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 10 }}>
            <div><div className="stat-label">This cycle's profit</div><div className={`stat-value ${c.payout.cycleNet >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 18 }}>{money(c.payout.cycleNet)}</div></div>
            <div><div className="stat-label">Available to request</div><div className="stat-value" style={{ fontSize: 18 }}>{money(c.payout.available)}</div></div>
            <div><div className="stat-label">Request bounds</div><div style={{ fontWeight: 600, marginTop: 4 }}>{money(c.payout.minPayout)} – {money(c.payout.maxRequest)}</div><div className="muted" style={{ fontSize: 11 }}>50% of balance{c.payout.payoutCap ? `, cap ${money(c.payout.payoutCap)}` : ''}</div></div>
            <div><div className="stat-label">Payouts taken</div><div className="stat-value" style={{ fontSize: 18 }}>{c.payout.taken}{c.payout.maxPayouts ? ` / ${c.payout.maxPayouts}` : ''}</div>{c.payout.remaining != null && <div className="muted" style={{ fontSize: 11 }}>{c.payout.remaining} until live</div>}</div>
          </div>

          {/* Cycle requirements */}
          <Check ok={!c.qualifying || c.qualifying.met}>
            <div className="row"><b>5 qualifying days this cycle (≥ {money(c.qualifying?.amount || 0)})</b><div className="spacer" />
              <span>{c.qualifying ? `${c.qualifying.have} / ${c.qualifying.need}` : '—'}</span></div>
          </Check>
          <Check ok={c.payout.cycleNetPositive}>
            <div className="row"><b>Positive net profit this cycle</b><div className="spacer" /><span>{money(c.payout.cycleNet)}</span></div>
          </Check>
          {c.payout.lastPayoutDate && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Cycle counts days after your last payout ({c.payout.lastPayoutDate}).</div>}

          {/* Log a payout */}
          {!c.payout.movedLive && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="muted">Log a payout:</span>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              <input type="number" placeholder={`$ (max ${money(c.payout.maxRequest)})`} value={payAmt}
                onChange={(e) => setPayAmt(e.target.value)} style={{ width: 150 }} />
              <button onClick={logPayout} disabled={!payAmt}>Record payout</button>
            </div>
          )}

          {c.payout.history.length > 0 && (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Date</th><th>Amount</th><th></th></tr></thead>
              <tbody>
                {c.payout.history.map((p) => (
                  <tr key={p.id}><td>{p.date}</td><td className="pos">{money(p.amount)}</td>
                    <td style={{ textAlign: 'right' }}><button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => removePayout(p.id)}>remove</button></td></tr>
                ))}
                <tr><td><b>Total paid out</b></td><td className="pos"><b>{money(c.payout.totalPaid)}</b></td><td></td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="muted" style={{ fontSize: 12 }}>
        Day-granularity from imported trades + manual days. Drawdown is simulated end-of-day (intraday swings between
        fills aren't visible). Rules come from this journal's settings — keep them matched to your firm.
      </div>
    </>
  );
}
