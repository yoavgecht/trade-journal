import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, money, fmt } from '../api.js';
import DayPanel from '../components/DayPanel.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const tooltipStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 };

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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke}
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
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="cum" stroke="#16a34a" strokeWidth={2} fill="url(#spark)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---- profit calendar -------------------------------------------------------

function ProfitCalendar({ equity, conv, onDayClick }) {
  const byDate = useMemo(() => Object.fromEntries(equity.map((d) => [d.date, d])), [equity]);
  const latest = equity.length ? equity[equity.length - 1].date : new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(() => latest.slice(0, 7)); // "YYYY-MM"

  const [year, month] = ym.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
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
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((d, i) => {
          const data = byDate[key(d)];
          const out = d.getMonth() !== month - 1;
          const today = key(d) === new Date().toISOString().slice(0, 10);
          const cls = data ? (data.pnl >= 0 ? 'green' : 'red') : '';
          const clickable = !out; // any in-month day: review trades or type in a manual P&L
          return (
            <div key={i} className={`cal-cell ${cls} ${out ? 'out' : ''} ${today ? 'today' : ''} ${clickable ? 'clickable' : ''}`}
              onClick={clickable ? () => onDayClick(key(d)) : undefined}
              title={clickable ? 'Open day review' : undefined}>
              <div className="cal-day">{d.getDate()}</div>
              {data && !out && (
                <div style={{ textAlign: 'center' }}>
                  <div className={`cal-pnl ${data.pnl >= 0 ? 'pos' : 'neg'}`}>{conv(data.pnl)}</div>
                  <div className="cal-trades">{data.trades} trade{data.trades !== 1 ? 's' : ''}</div>
                  <div className="cal-bar" style={{
                    width: `${Math.max(12, (Math.abs(data.pnl) / maxAbs) * 100)}%`,
                    margin: '4px auto 0',
                    background: data.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- page ------------------------------------------------------------------

export default function Overview({ dataVersion, journal, onOpenImport }) {
  const [d, setD] = useState(null);
  const [risk, setRisk] = useState(null);
  const [unit, setUnit] = useState('usd');
  const [reviewDay, setReviewDay] = useState(null);
  const [localV, setLocalV] = useState(0); // bumped by DayPanel edits
  const navigate = useNavigate();

  useEffect(() => {
    api('/dashboard').then(setD);
    api('/risk').then(setRisk);
  }, [dataVersion, localV]);

  if (!d) return null;
  const empty = d.trades === 0 && d.equity.length === 0;
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
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="unit-tabs">
          <button className={`unit-tab ${unit === 'usd' ? 'on' : ''}`} onClick={() => setUnit('usd')}>United States Dollar (USD)</button>
          <button className={`unit-tab ${unit === 'pct' ? 'on' : ''}`} onClick={() => setUnit('pct')}>Return (%)</button>
          <button className="unit-tab" disabled title="Needs per-trade stop-loss data — planned">R Multiple</button>
        </div>
        <div className="spacer" />
        {d.issues.length > 0 && (
          <div className="banner" onClick={() => navigate('/patterns')}
            title={d.issues.join('\n')}>
            ✦ Edge check found <b>{d.issues.length} insight{d.issues.length > 1 ? 's' : ''}</b> in your journal <span className="muted">›</span>
          </div>
        )}
      </div>

      {empty ? (
        <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{journal.name} has no trades yet</div>
          <div className="muted" style={{ marginBottom: 16 }}>
            Export your trades from Tradovate (Reports → Fills) and import them here.
          </div>
          <button onClick={onOpenImport}>Import Trades</button>
        </div>
      ) : (
        <>
          {/* Top stat cards */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
            <div className="panel">
              <div className="stat-label">Net Return {unit === 'usd' ? '($)' : '(%)'}</div>
              <div className={`stat-value ${d.totalPnl >= 0 ? 'pos' : 'neg'}`}>{conv(d.totalPnl)}</div>
              <Sparkline data={d.equity} />
            </div>
            <div className="panel" style={{ textAlign: 'center' }}>
              <div className="stat-label" style={{ textAlign: 'left' }}>Winrate</div>
              <Gauge pct={d.winRate} />
              <div style={{ fontWeight: 700, marginTop: -4 }}>{fmt(d.winRate)}%</div>
              <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-around', marginTop: 2 }}>
                <span className="pos">{d.counts.wins}</span>
                <span className="muted">{d.counts.be}</span>
                <span className="neg">{d.counts.losses}</span>
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

          {/* Trading growth curve — balance vs the minimum-balance (trailing
              drawdown) line, like the prop firm's analytics page. */}
          {risk && risk.series.length > 0 && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <h2>Trading Growth Curve <span className="muted" style={{ textTransform: 'none', fontWeight: 500 }}>
                — distance to blowout: <b className={risk.distance < risk.trailingDd * 0.35 ? 'neg' : 'pos'}>{money(risk.distance)}</b>
              </span></h2>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={risk.series}>
                  <defs>
                    <linearGradient id="growfill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d4a017" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#d4a017" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#6b7280" fontSize={10} />
                  <YAxis stroke="#6b7280" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
                  <Area type="monotone" dataKey="balance" name="Balance" stroke="#d4a017" strokeWidth={2.5} fill="url(#growfill)" dot={false} />
                  <Area type="stepAfter" dataKey="threshold" name="Minimum Balance" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 3" fill="none" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Calendar + evaluation */}
          <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginBottom: 14, alignItems: 'start' }}>
            <ProfitCalendar equity={d.equity} conv={conv} onDayClick={setReviewDay} />
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
          </div>

          {/* Bottom row */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div className="panel">
              <h2>Performance by Instrument</h2>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={Object.entries(d.byProduct).map(([k, v]) => ({ name: k, pnl: v.pnl }))}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
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
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
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
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
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
      )}
      {reviewDay && <DayPanel date={reviewDay} onClose={() => setReviewDay(null)} onChanged={() => setLocalV((v) => v + 1)} />}
    </>
  );
}
