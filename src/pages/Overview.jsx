import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, money, fmt } from '../api.js';
import { fundedRulesFor } from '../presets.js';
import PassFundedModal from '../components/PassFundedModal.jsx';
import PayoutModal from '../components/PayoutModal.jsx';
import BrokerCredentials from '../components/BrokerCredentials.jsx';
import TradeReports from '../components/TradeReports.jsx';
import DayPanel from '../components/DayPanel.jsx';
import DashboardStats from './DashboardStats.jsx';
import AccountData from './AccountData.jsx';
import ClosedTrades from './ClosedTrades.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const tooltipStyle = { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8 };

// ---- small SVG widgets -----------------------------------------------------

// Semicircle gauge: green portion = pct, red the rest (Edgewonk winrate style).
function Gauge({ pct, size = 86 }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = Math.PI * r; // half circumference
  const green = (Math.max(0, Math.min(100, pct)) / 100) * c;
  const cx = size / 2, cy = size / 2;
  const arc = `M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`;
  return (
    <svg width={size} height={size / 2 + 6}>
      <path d={arc} fill="none" stroke="var(--red)" strokeWidth={stroke} strokeLinecap="round" />
      <path d={arc} fill="none" stroke="var(--green)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${green} ${c}`} />
    </svg>
  );
}

// Segmented donut (Edgewonk score style) — dashes around the ring, colored
// portion = value/100.
function Donut({ value, color, size = 64, stroke = 9, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const seg = c / 14; // 14 dashes
  const filled = (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(128,128,128,0.18)" strokeWidth={stroke}
          strokeDasharray={`${seg * 0.62} ${seg * 0.38}`} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${seg * 0.62} ${seg * 0.38}`} />
        {/* panel-colored arc on top hides the colored ring beyond the filled portion */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel)" strokeWidth={stroke + 2}
          strokeDasharray={`${c - filled} ${filled}`} strokeDashoffset={-filled} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
        {children}
      </div>
    </div>
  );
}

// Proportional green/red bar — avg win vs avg loss magnitude.
function SplitBar({ win, loss }) {
  const w = Math.abs(win), l = Math.abs(loss);
  const total = w + l || 1;
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${(w / total) * 100}%`, background: 'var(--green)' }} />
      <div style={{ width: `${(l / total) * 100}%`, background: 'var(--red)' }} />
    </div>
  );
}

function Sparkline({ data }) {
  // Need ≥2 points to draw a line — a single trading day would render as a lone
  // dot, so prepend a 0 baseline (start → cum). Color by direction (up/down).
  const series = (data || []).length === 1 ? [{ cum: 0 }, data[0]] : (data || []);
  if (series.length < 2) return <div style={{ height: 36 }} />;
  const up = series[series.length - 1].cum >= 0;
  const color = up ? '#16a34a' : '#dc2626';
  const gid = up ? 'spark-up' : 'spark-down';
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={series} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="cum" stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// MFFU-style stat block beside the growth curve.
function GrowthBlock({ label, value, sub, signed }) {
  const cls = signed == null ? '' : signed >= 0 ? 'pos' : 'neg';
  return (
    <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${cls}`} style={{ fontSize: 19 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

// ---- profit calendar -------------------------------------------------------

function ProfitCalendar({ equity, payouts, funded, conv, onDayClick }) {
  const byDate = useMemo(() => Object.fromEntries(equity.map((d) => [d.date, d])), [equity]);
  const payoutByDate = useMemo(() => {
    const m = {};
    for (const p of (payouts || [])) m[p.date] = (m[p.date] || 0) + p.amount;
    return m;
  }, [payouts]);
  const latest = equity.length ? equity[equity.length - 1].date : new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(() => latest.slice(0, 7)); // "YYYY-MM"

  const [year, month] = ym.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = first.getDay(); // Sunday-first (MFFU-style; 0 = Sunday)
  const gridStart = new Date(year, month - 1, 1 - startOffset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  const maxAbs = Math.max(1, ...cells.map((d) => Math.abs(byDate[key(d)]?.pnl || 0)));
  function key(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const nav = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="panel">
      <div className="cal-head">
        <h2 style={{ margin: 0 }}>Profit Calendar</h2>
        <div className="spacer" />
        <button className="cal-nav" onClick={() => nav(-1)}>‹</button>
        <span className="cal-title">{MONTHS[month - 1]} {year}</span>
        <button className="cal-nav" onClick={() => nav(1)}>›</button>
      </div>
      <div className="cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((d, i) => {
          const data = byDate[key(d)];
          const payout = payoutByDate[key(d)];
          const out = d.getMonth() !== month - 1;
          const today = key(d) === key(new Date()); // local date, not UTC
          const cls = data ? (data.pnl >= 0 ? 'green' : 'red') : '';
          // A trading day (or a payout day) is always shown + clickable, even when
          // it spills into an adjacent-month cell (e.g. Jun 30 in the July grid) —
          // otherwise days that straddle a month boundary silently disappear.
          const clickable = !out || !!data || payout != null;
          const faded = out && !data && payout == null; // only fade EMPTY out-of-month spacers
          return (
            <div key={i} className={`cal-cell ${cls} ${faded ? 'out' : ''} ${today ? 'today' : ''} ${clickable ? 'clickable' : ''}`}
              onClick={clickable ? () => onDayClick(key(d)) : undefined}
              title={clickable ? 'Open day review' : undefined}>
              <div className="cal-day">{today && <span className="cal-today-dot" />}{d.getDate()}</div>
              <div style={{ textAlign: 'center' }}>
                {payout != null && <div className="cal-payout">↓ {money(payout)} Payout</div>}
                {data && (
                  <>
                    <div className={`cal-pnl ${data.pnl >= 0 ? 'pos' : 'neg'}`}>{conv(data.pnl)}</div>
                    <div className="cal-trades">{data.trades} trade{data.trades !== 1 ? 's' : ''}</div>
                    <div className="cal-bar" style={{
                      width: `${Math.max(12, (Math.abs(data.pnl) / maxAbs) * 100)}%`,
                      margin: '4px auto 0',
                      background: data.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                    }} />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="cal-legend">
        <span><i className="dot" style={{ background: 'var(--green)' }} /> Profit</span>
        <span><i className="dot" style={{ background: 'var(--red)' }} /> Loss</span>
        {funded && <span><i className="dot" style={{ background: 'var(--accent)' }} /> Payout</span>}
        <span><i className="dot" style={{ background: '#f59e0b' }} /> Today</span>
      </div>
    </div>
  );
}

// ---- page ------------------------------------------------------------------

export default function Overview({ dataVersion, journal, onOpenImport, onDataChanged, onJournalPatched }) {
  const [d, setD] = useState(null);
  const [risk, setRisk] = useState(null);
  const [chal, setChal] = useState(null);
  const [unit, setUnit] = useState('usd');
  const [reviewDay, setReviewDay] = useState(null);
  const [localV, setLocalV] = useState(0); // bumped by DayPanel edits
  const [passOpen, setPassOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifSeen, setNotifSeen] = useState(false); // hide the badge after the first open
  const navigate = useNavigate();

  useEffect(() => {
    api('/dashboard').then(setD);
    api('/risk').then(setRisk);
    api('/challenge').then(setChal).catch(() => setChal(null));
  }, [dataVersion, localV, journal.id]);

  // Pass / Blown — enable on target (evals only) / trailing-stop breach.
  // Archiving keeps all data; a pass also spins up a matching funded account.
  const isEval = chal && (chal.phase || journal.phase) !== 'funded';
  const canPass = !!(isEval && chal.status === 'passed');
  const canBlow = !!(chal && chal.status === 'failed');
  const archive = async (outcome, fundedName = null) => {
    let fundedRules = null;
    if (outcome === 'passed') {
      fundedRules = fundedRulesFor(journal.firm, journal.start_balance);
    } else if (!window.confirm(`Archive "${journal.name}" as BLOWN?\n\nAll its data (P&L, trades, chart) is kept for your records.`)) {
      return;
    }
    const r = await api(`/journals/${journal.id}/archive`, { method: 'POST', body: { outcome, fundedName, fundedRules } });
    if (r?.funded) localStorage.setItem('pendingActive', String(r.funded.id));
    if (outcome === 'passed') {
      window.location.assign('/');
    } else {
      window.location.assign('/archive');
    }
  };

  if (!d) return null;
  const ratio = d.avgLoss !== 0 ? Math.abs(d.avgWin / d.avgLoss) : null;
  const pfFill = d.profitFactor == null ? 0 : Math.min(8, Math.round(d.profitFactor * 2.5));
  const scoreColor = d.score >= 75 ? 'var(--green)' : d.score >= 45 ? '#f59e0b' : 'var(--red)';

  // Unit toggle: dollars or % of starting balance (Edgewonk's USD / Return %).
  const conv = (v) => {
    if (v == null) return '—';
    if (unit === 'usd' || !d.startBalance) return money(v);
    const pct = (v / d.startBalance) * 100;
    return `${pct < 0 ? '-' : ''}${Math.abs(pct).toFixed(2)}%`;
  };
  const holdFmt = d.avgHoldS == null ? '—'
    : d.avgHoldS < 60 ? `${d.avgHoldS}s`
    : d.avgHoldS < 3600 ? `${(d.avgHoldS / 60).toFixed(0)}m`
    : `${(d.avgHoldS / 3600).toFixed(1)}h`;

  return (
    <>
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>{journal.phase === 'funded' ? `Funded — ${journal.name}` : journal.name}</h1>
        {journal.phase !== 'funded' && <span className="market-chip" style={{ fontSize: 11 }}>Challenge</span>}
        {journal.last_import_at && <span className="muted" style={{ fontSize: 12 }}>· last import {new Date(journal.last_import_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="spacer" />
        {chal && (
          <>
            <button className="link-btn" style={{ fontSize: 12 }} onClick={() => navigate('/challenge')}>Rules &amp; payouts ›</button>
            {isEval && (
              <button onClick={() => canPass && setPassOpen(true)} disabled={!canPass} className="ghost"
                style={{ borderColor: canPass ? 'var(--green)' : undefined, color: canPass ? 'var(--green)' : 'var(--muted)', fontWeight: 700 }}
                title={canPass ? 'Archive as PASSED and open a matching funded account' : `Reach the ${money(chal.target)} target to enable`}>
                ✓ Passed
              </button>
            )}
            {!isEval && chal.payout && (
              <button onClick={() => chal.payout.eligible && setPayoutOpen(true)} disabled={!chal.payout.eligible} className="ghost"
                style={{ borderColor: chal.payout.eligible ? 'var(--accent)' : undefined, color: chal.payout.eligible ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}
                title={chal.payout.eligible ? 'Record a payout' : 'Meet the payout requirements (5 winning days, consistency, positive cycle) to enable'}>
                💸 Take Payout
              </button>
            )}
            <button onClick={() => archive('blown')} className="ghost"
              style={{ borderColor: 'var(--red)', color: 'var(--red)', cursor: 'pointer', fontWeight: 700 }}
              title="Archive as BLOWN">
              ✕ Blown
            </button>
          </>
        )}
        {d.issues.length > 0 && (
          <div className="notif-wrap">
            <button className="bell-btn" onClick={() => { setNotifOpen((o) => !o); setNotifSeen(true); }} title="Edge check insights">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {!notifSeen && <span className="bell-badge">{d.issues.length}</span>}
            </button>
            {notifOpen && (
              <>
                <div className="notif-backdrop" onClick={() => setNotifOpen(false)} />
                <div className="notif-pop">
                  <div className="notif-head">Edge check · {d.issues.length} insight{d.issues.length > 1 ? 's' : ''}</div>
                  {d.issues.map((it, i) => <div key={i} className="notif-item">✦ {it}</div>)}
                  <button className="notif-cta" onClick={() => { setNotifOpen(false); navigate('/patterns'); }}>View in Patterns ›</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <BrokerCredentials journal={journal} onImport={onOpenImport} onSaved={onJournalPatched} onChanged={onDataChanged} />

      {/* Full dashboard always renders — a blank account just shows zeros + the
          flat baseline chart (recharts renders empty data as nothing). */}
      <>
          {/* Top stat cards */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
            <div className="panel">
              <div className="stat-label">Net Return {unit === 'usd' ? '($)' : '(%)'}</div>
              <div className={`stat-value ${d.totalPnl >= 0 ? 'pos' : 'neg'}`}>{conv(d.totalPnl)}</div>
              <Sparkline data={d.equity} />
            </div>
            <div className="panel" style={{ textAlign: 'center' }}>
              <div className="stat-label" style={{ textAlign: 'left' }}>Winrate <span className="muted" style={{ fontWeight: 400 }}>(excl. break-even)</span></div>
              <div style={{ margin: '10px 0 6px' }}><Gauge pct={d.winRateNoBe ?? d.winRate} /></div>
              <div style={{ fontWeight: 700, marginTop: -4 }}>{fmt(d.winRateNoBe ?? d.winRate)}%</div>
              <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '0 14px' }}>
                <span className="pos" title="Wins (> $10)">{d.counts.wins} W</span>
                <span className="muted" title="Break-even / scratch (±$10)">{d.counts.be} BE</span>
                <span className="neg" title="Losses (< −$10)">{d.counts.losses} L</span>
              </div>
            </div>
            <div className="panel">
              <div className="stat-label">Avg P&L {unit === 'usd' ? '($)' : '(%)'} <span style={{ float: 'right', fontWeight: 700, color: 'var(--text)' }}>{ratio == null ? '—' : `${fmt(ratio)}:1`}</span></div>
              <div className={`stat-value ${d.expectancy >= 0 ? 'pos' : 'neg'}`}>{conv(d.expectancy)}</div>
              <SplitBar win={d.avgWin} loss={d.avgLoss} />
              <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span className="pos">{conv(d.avgWin)}</span>
                <span className="neg">{conv(d.avgLoss)}</span>
              </div>
            </div>
            <div className="panel">
              <div className="stat-label">Profit Factor</div>
              <div className="stat-value">{fmt(d.profitFactor)}</div>
              <div className="pf-squares">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="pf-sq" style={i < pfFill ? { background: '#f59e0b' } : undefined} />
                ))}
              </div>
            </div>
            <div className="panel row" style={{ gap: 14 }}>
              <div>
                <div className="stat-label">Discipline Score</div>
                <div className="stat-value">{d.score}</div>
                <div className="muted" style={{ fontSize: 11 }}>revenge · sizing · limits</div>
              </div>
              <div className="spacer" />
              <Donut value={d.score} color={scoreColor} />
            </div>
          </div>

          {/* Trading growth curve (MFFU-style): balance vs the trailing-drawdown
              floor, with the account's key blocks down the right. */}
          {risk && risk.series.length > 0 && (() => {
            const start = risk.startBalance;
            const equity = risk.currentBalance;
            const floor = risk.currentThreshold;
            const aboveFloor = risk.distance;            // equity − floor
            const target = risk.targetBalance;           // pass level (start + profit target) — EVALS ONLY
            // Funded (Apex PA): no target; instead the trailing DD LOCKS once balance
            // hits start + dd + buffer (e.g. $52,100). That's the line worth showing.
            const lockLine = journal.phase === 'funded' ? risk.lockAt : null;
            // Clean round-$1k Y ticks so the reference lines land exactly on their labels.
            const yVals = risk.series.flatMap((p) => [p.balance, p.threshold]);
            if (target) yVals.push(target);
            if (lockLine) yVals.push(lockLine);
            const yMin = Math.floor(Math.min(...yVals) / 1000) * 1000;
            const yMax = Math.ceil(Math.max(...yVals) / 1000) * 1000 + 1000; // headroom for the target label
            const yTicks = [];
            for (let v = yMin; v <= yMax; v += 1000) yTicks.push(v);
            const funded = journal.phase === 'funded';
            // Funded (PA): the "buffer" is your starting capital — show profit ABOVE it,
            // never negative (a fresh account has $0 profit, not the trailing-stop cushion).
            const aboveBuffer = funded ? Math.max(0, equity - start) : aboveFloor;
            const pct = (n, base) => base ? `${n >= 0 ? '' : ''}${((n / base) * 100).toFixed(2)}%` : '—';
            return (
              <div className="panel" style={{ marginBottom: 14 }}>
                <h2>Trading Growth Curve {risk.breachedOn && <span className="neg" style={{ textTransform: 'none' }}>· account blown {risk.breachedOn}</span>}</h2>
                <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 320 }}>
                    <ResponsiveContainer width="100%" height={340}>
                      <AreaChart data={risk.series}>
                        <defs>
                          <linearGradient id="growfill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#d4a017" stopOpacity={0.32} />
                            <stop offset="100%" stopColor="#d4a017" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="dangerfill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#dc2626" stopOpacity={0.28} />
                            <stop offset="100%" stopColor="#dc2626" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(128,128,128,0.18)" strokeDasharray="3 3" />
                        <XAxis dataKey="date" stroke="#6b7280" fontSize={10} />
                        <YAxis stroke="#6b7280" fontSize={11} domain={[yMin, yMax]} ticks={yTicks} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} cursor={false} formatter={(v) => money(v)} />
                        {/* Gold balance area under, then the red "danger zone" under the trailing
                            stop on top — so below the floor reads red, above it reads gold. */}
                        <Area type="monotone" dataKey="balance" name="Balance" stroke="#d4a017" strokeWidth={2.5} fill="url(#growfill)" dot={false} />
                        <Area type="monotone" dataKey="threshold" name="Trailing stop" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 3" fill="url(#dangerfill)" dot={false} />
                        {target && (
                          <ReferenceLine y={target} stroke="#16a34a" strokeDasharray="6 4" strokeWidth={1.5}
                            label={{ value: `Target ${money(target)}`, position: 'insideTopRight', fill: '#16a34a', fontSize: 11, fontWeight: 700 }} />
                        )}
                        {lockLine && (
                          <ReferenceLine y={lockLine} stroke="#16a34a" strokeDasharray="6 4" strokeWidth={1.5}
                            label={{ value: `Trailing DD locks at ${money(lockLine)}`, position: 'insideTopRight', fill: '#16a34a', fontSize: 11, fontWeight: 700 }} />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ width: 230, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <GrowthBlock label="Net Profit / Loss" value={money(d.totalPnl)} sub={pct(d.totalPnl, start)} signed={d.totalPnl} />
                    <GrowthBlock label={funded ? 'Profit Above Buffer' : 'Profit Above Trailing Stop'}
                      value={money(aboveBuffer)} sub={pct(aboveBuffer, funded ? start : equity)} signed={aboveBuffer} />
                    <GrowthBlock label="Current Equity" value={money(equity)} sub={pct(d.totalPnl, start)} />
                    <GrowthBlock label="Max Drawdown" value={money(floor)} sub={`-${pct(risk.trailingDd, start)}`} />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Account Data strip (right under the graph) + Payout Requirements
              (funded accounts only). */}
          <AccountData d={d} journal={journal} c={chal} />

          {/* Calendar — full width, MFFU style. Key on the account so it re-opens
              on that account's latest month (or the current month if it's blank)
              instead of staying stuck on the first-loaded account's month. */}
          <div style={{ marginBottom: 14 }}>
            <ProfitCalendar key={journal.id} equity={d.equity} payouts={chal?.payout?.history} funded={journal.phase === 'funded'} conv={conv} onDayClick={setReviewDay} />
          </div>

          {/* All-time Statistics grid */}
          <DashboardStats d={d} />

          {/* Trade Reports — performance / count / win-rate by duration / day / week / month */}
          <TradeReports dataVersion={dataVersion + localV} />

          {/* Closed trades — this account's trades */}
          <ClosedTrades dataVersion={dataVersion} journal={journal} />

          {/* Evaluation + breakdown charts */}
          <div className="grid" style={{ gridTemplateColumns: '1.15fr 1fr 1fr 1fr', alignItems: 'start' }}>
            <div className="panel">
              <h2>Evaluation</h2>
              <div className="eval-row"><span className="k">Total Number of Trades</span><span className="v">{d.trades}</span></div>
              <div className="eval-row"><span className="k">Avg. Profit per Trading Day</span><span className={`v ${d.avgProfitPerDay >= 0 ? 'pos' : 'neg'}`}>{conv(d.avgProfitPerDay)}</span></div>
              <div className="eval-row"><span className="k">Biggest Winner</span><span className="v pos">{conv(d.biggestWin)}</span></div>
              <div className="eval-row"><span className="k">Biggest Loser</span><span className="v neg">{conv(d.biggestLoss)}</span></div>
              <div className="eval-row"><span className="k">Total Fees</span><span className="v">{conv(d.fees)}</span></div>
              <div className="eval-row"><span className="k">Avg. Hold Time</span><span className="v">{holdFmt}</span></div>
              <div className="eval-row"><span className="k">Winrate w/o BE</span><span className="v">{d.winRateNoBe == null ? '—' : `${fmt(d.winRateNoBe)}%`}</span></div>
              <div className="eval-row"><span className="k">ROI</span><span className={`v ${d.roiPct >= 0 ? 'pos' : 'neg'}`}>{d.roiPct == null ? '—' : `${fmt(d.roiPct)}%`}</span></div>
              <div className="eval-row"><span className="k">Max Drawdown</span><span className="v">{fmt(d.maxDdPct)}%</span></div>
              <div className="eval-row"><span className="k">Winning / Losing Days</span><span className="v">{d.greenDays} / {d.redDays}</span></div>
              <div className="eval-row"><span className="k">Trades Per Day / Week</span><span className="v">{fmt(d.tradesPerDay)} / {fmt(d.tradesPerWeek)}</span></div>
              <div className="eval-row">
                <span className="k">Current Streak</span>
                <span className="v">{d.last5.map((r, i) => <span key={i} className={`chip ${r}`}>{r}</span>)}</span>
              </div>
            </div>
            <div className="panel">
              <h2>Performance by Instrument</h2>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={Object.entries(d.byProduct).map(([k, v]) => ({ name: k, pnl: v.pnl }))}>
                  <CartesianGrid stroke="rgba(128,128,128,0.18)" strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="#6b7280" fontSize={11} />
                  <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
                  <ReferenceLine y={0} stroke="#9ca3af" />
                  <Bar dataKey="pnl" name="P&L">
                    {Object.values(d.byProduct).map((v, i) => <Cell key={i} fill={v.pnl >= 0 ? '#16a34a' : '#dc2626'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="panel">
              <h2>Performance by Weekday</h2>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={d.byDow}>
                  <CartesianGrid stroke="rgba(128,128,128,0.18)" strokeDasharray="3 3" />
                  <XAxis dataKey="dow" stroke="#6b7280" fontSize={11} tickFormatter={(x) => DOW[x]} />
                  <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} labelFormatter={(x) => DOW[x]} />
                  <ReferenceLine y={0} stroke="#9ca3af" />
                  <Bar dataKey="pnl" name="P&L">
                    {d.byDow.map((v, i) => <Cell key={i} fill={v.pnl >= 0 ? '#16a34a' : '#dc2626'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="panel">
              <h2>Equity Graph</h2>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={d.equity}>
                  <defs>
                    <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#16a34a" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(128,128,128,0.18)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#6b7280" fontSize={10} />
                  <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
                  <ReferenceLine y={0} stroke="#9ca3af" />
                  <Area type="monotone" dataKey="cum" name="Cumulative P&L" stroke="#16a34a" strokeWidth={2} fill="url(#eqfill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      {reviewDay && <DayPanel date={reviewDay} onClose={() => setReviewDay(null)} onChanged={() => setLocalV((v) => v + 1)} />}
      {passOpen && (
        <PassFundedModal firm={journal.firm} evalName={journal.name}
          onCancel={() => setPassOpen(false)}
          onConfirm={(name) => { setPassOpen(false); archive('passed', name); }} />
      )}
      {payoutOpen && chal?.payout && (
        <PayoutModal payout={chal.payout}
          onCancel={() => setPayoutOpen(false)}
          onDone={() => { setPayoutOpen(false); setLocalV((v) => v + 1); onDataChanged?.(); }} />
      )}
    </>
  );
}
