import React from 'react';
import { money, fmt } from '../api.js';

// ── Inline line-icons (no icon lib on the client) ────────────────────────────
const svg = (p, extra = {}) => (
  <svg width={extra.size || 17} height={extra.size || 17} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
);
const ICON = {
  calendar: svg(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>),
  badge: svg(<><circle cx="12" cy="8" r="5" /><path d="M9 12.5 8 22l4-2 4 2-1-9.5" /></>),
  xcircle: svg(<><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>),
  check: svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>),
  dollar: svg(<><path d="M12 2v20M17 6a5 3.5 0 0 0-5-2c-2.8 0-5 1.3-5 3.3 0 4.7 10 2.3 10 7 0 2-2.2 3.4-5 3.4a5.5 3.5 0 0 1-5-2" /></>),
  bank: svg(<><path d="M3 21h18M4 10h16M5 10l7-6 7 6M6 10v11M18 10v11M10 10v11M14 10v11" /></>),
  monitor: svg(<><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  wallet: svg(<><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M16 14h2" /></>),
  trend: svg(<><path d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" /></>),
  percent: svg(<><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>),
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>, { size: 15 }),
};

const fmtDate = (s) => (s ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US') : '—');

function Stars({ have, need }) {
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
      {[...Array(need)].map((_, i) => (
        <span key={i} style={{ fontSize: 14, color: i < have ? '#f59e0b' : 'var(--border)' }}>★</span>
      ))}
    </div>
  );
}

function Bar({ pct, ok }) {
  return (
    <div style={{ height: 8, borderRadius: 5, background: 'var(--panel2)', overflow: 'hidden', marginTop: 8 }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: ok ? 'var(--green)' : 'var(--accent)' }} />
    </div>
  );
}

const Pill = ({ ok, children }) => (
  <span className="req-pill" style={{
    color: ok ? 'var(--green)' : 'var(--red)',
    background: ok ? 'var(--green-soft)' : 'var(--red-soft)',
  }}>{children}</span>
);

// Account Data strip + (funded only) Payout Requirements — sits right under the
// growth curve on the Dashboard. Account meta comes from `journal` + `d`
// (dashboard); the payout rules come from the challenge payload.
export default function AccountData({ d, journal, c }) {
  const currentBalance = journal.start_balance + (d?.totalPnl || 0);

  // Status field flips label/value/icon by outcome.
  let statusItem;
  if (c?.status === 'failed') {
    statusItem = { icon: ICON.xcircle, label: 'Failed on', value: fmtDate(c.drawdown?.breachedOn || journal.archived_at), color: 'var(--red)' };
  } else if (c?.status === 'passed' && (c.phase || journal.phase) !== 'funded') {
    statusItem = { icon: ICON.check, label: 'Passed on', value: fmtDate(c.passedOn), color: 'var(--green)' };
  } else {
    const label = c?.status === 'passed' ? 'Payout ready' : 'In progress';
    statusItem = { icon: ICON.check, label: 'Status', value: label, color: c?.status === 'passed' ? 'var(--green)' : '#f59e0b' };
  }

  const items = [
    { icon: ICON.calendar, label: 'Start Date', value: fmtDate(journal.deposit_date || journal.created_at) },
    { icon: ICON.badge, label: 'Account Type', value: journal.phase === 'funded' ? 'Sim Funded' : 'Evaluation' },
    statusItem,
    { icon: ICON.dollar, label: 'Starting Balance', value: money(journal.start_balance) },
    { icon: ICON.dollar, label: 'Current Balance',
      // `+` means in profit vs the starting balance (not just balance > 0).
      value: (currentBalance >= journal.start_balance ? '+' : '') + money(currentBalance),
      color: currentBalance >= journal.start_balance ? 'var(--green)' : 'var(--red)' },
    { icon: ICON.bank, label: 'Broker', value: journal.broker || '—' },
    { icon: ICON.monitor, label: 'Platform', value: journal.platform || 'Tradovate' },
    { icon: ICON.clock, label: 'Updated', value: fmtDate(journal.last_import_at) },
  ];

  // ── Payout requirements (funded only) ──────────────────────────────────────
  // Requirements mirror exactly what the server's payout.eligible gates on, so
  // the "X of N met" count and the Eligible badge always agree. (Rules vary by
  // firm: Apex funded = positive cycle only; Lucid/MFFU add winning days, etc.)
  const isFunded = (c?.phase || journal.phase) === 'funded';
  const reqs = [];
  if (c?.payout) {
    if (c.qualifying) {
      reqs.push({
        icon: ICON.calendar, cat: 'Trading Activity',
        title: `${c.qualifying.need} Winning Days Required`,
        desc: `Must have ${c.qualifying.need} days with at least ${money(c.qualifying.amount)} profit`,
        met: c.qualifying.met, stars: { have: c.qualifying.have, need: c.qualifying.need },
      });
    }
    reqs.push({
      icon: ICON.trend, cat: 'Trading Activity',
      title: 'Profit This Cycle',
      desc: 'Net profit since your last payout must be positive',
      met: c.payout.cycleNetPositive,
      value: money(c.payout.cycleNet), valueColor: c.payout.cycleNet >= 0 ? 'var(--green)' : 'var(--red)',
    });
    // Payouts-remaining lives on the Rules & payouts page (Payout center).
  }
  // Consistency + daily-loss-limit rules live on the Rules & payouts page (the
  // Challenge view), not here — this panel is the payout-cycle summary.
  const metCount = reqs.filter((r) => r.met).length;

  return (
    <>
      {/* Account Data strip */}
      <div className="panel account-strip" style={{ marginBottom: 14 }}>
        <div className="ad-title"><span className="ad-accent" />Account Data</div>
        <div className="ad-items">
          {items.map((it, i) => (
            <div className="ad-item" key={i}>
              <span className="ad-icon">{it.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ad-label">{it.label}</div>
                <div className="ad-value" style={it.color ? { color: it.color } : undefined}>{it.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Requirement cards — funded payout rules, or a challenge's consistency rule */}
      {reqs.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="ad-accent" style={{ marginRight: 2 }} />
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{ICON.info}</span>
            <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text)', textTransform: 'none', fontWeight: 800 }}>{isFunded ? 'Payout Requirements' : 'Challenge Rules'}</h2>
            <span className="muted" style={{ fontSize: 12 }}>{metCount} of {reqs.length} requirements met</span>
            <div className="spacer" />
            {isFunded
              ? <Pill ok={c.payout.eligible}>{c.payout.eligible ? 'Eligible' : 'Not Eligible'}</Pill>
              : <Pill ok={metCount === reqs.length}>{metCount === reqs.length ? 'On Track' : 'Rule Not Met'}</Pill>}
          </div>
          <div className="req-grid">
            {reqs.map((r, i) => (
              <div className="req-card" key={i}>
                <div className="row" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
                  <span className="req-icon">{r.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="req-cat">{r.cat}</div>
                    <div className="req-title">{r.title}</div>
                  </div>
                  <Pill ok={r.met}>{r.met ? 'Passed' : 'Not Met'}</Pill>
                </div>
                <div className="req-desc">{r.desc}</div>
                {r.value && !r.bar && (
                  <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6, color: r.valueColor || 'var(--text)' }}>{r.value}</div>
                )}
                {r.stars && <Stars have={r.stars.have} need={r.stars.need} />}
                {r.consistency && (() => {
                  const cn = r.consistency;
                  // Bar fills as your biggest day approaches the cap ceiling (use
                  // the EFFECTIVE cap incl. any cushion so it agrees with compliant).
                  const fill = cn.effectivePct > 0 ? (cn.bestDayShare / cn.effectivePct) * 100 : 0;
                  // A dominant day forces a higher total to stay legal: on an eval
                  // that raises the pass target; on a funded acct it's the net profit
                  // you must reach before a payout can be requested.
                  const newTarget = Math.max(c.target || 0, cn.requiredTotal);
                  const raised = cn.requiredTotal > (c.target || 0);
                  return (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6, color: cn.compliant ? 'var(--green)' : 'var(--red)' }}>
                        {fmt(cn.bestDayShare)}%
                        <span className="muted" style={{ fontSize: 12, fontWeight: 600, marginLeft: 6 }}>biggest day (limit {cn.pct}%)</span>
                      </div>
                      <Bar pct={fill} ok={cn.compliant} />
                      <div className="req-desc" style={{ marginTop: 6 }}>
                        Biggest day {money(cn.bestDay)} · net profit {money(cn.cycleNet)}
                      </div>
                      {cn.compliant && cn.maxDay > 0 && (
                        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', fontSize: 13 }}>
                          No single day may exceed <b>{money(cn.maxDay)}</b>
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{cn.pct}% of your {money(cn.cycleNet)} profit — a bigger single day breaks the rule.</div>
                        </div>
                      )}
                      {!cn.compliant && cn.requiredTotal > 0 && (
                        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--red) 9%, transparent)', fontSize: 13 }}>
                          {isFunded ? (
                            <>Request a payout once net profit reaches <b>{money(cn.requiredTotal)}</b>
                              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{money(cn.additionalNeeded)} more to satisfy the {cn.pct}% rule.</div></>
                          ) : (
                            <>{raised ? 'New target to pass' : 'Target to pass'}: <b>{money(newTarget)}</b>
                              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                {raised && <>Raised from {money(c.target)} by your {money(cn.bestDay)} day — </>}
                                {money(Math.max(0, newTarget - cn.cycleNet))} more to go.
                              </div></>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
                {r.bar && (
                  <>
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                      <b>{money(r.bar.value)}</b>
                      <span className="muted" style={{ fontSize: 12 }}>{money(r.bar.target)}</span>
                    </div>
                    <Bar pct={r.bar.target > 0 ? (r.bar.value / r.bar.target) * 100 : 100} ok={r.met} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
