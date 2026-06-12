import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, money, fmt } from '../api.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const tooltipStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 };

// ---- small SVG widgets -----------------------------------------------------

// Donut from segments [{value, color}]; children render in the center.
function Donut({ segments, size = 64, stroke = 9, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
              strokeWidth={stroke} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
        {children}
      </div>
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

function ProfitCalendar({ equity }) {
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
          const cls = data ? (data.pnl >= 0 ? 'green' : 'red') : '';
          return (
            <div key={i} className={`cal-cell ${cls} ${out ? 'out' : ''}`}>
              <div className="cal-day">{d.getDate()}</div>
              {data ? (
                <>
                  <div className={`cal-pnl ${data.pnl >= 0 ? 'pos' : 'neg'}`}>{money(data.pnl)}</div>
                  <div className="cal-trades">{data.trades} trade{data.trades !== 1 ? 's' : ''}</div>
                  <div className="cal-bar" style={{
                    width: `${Math.max(12, (Math.abs(data.pnl) / maxAbs) * 100)}%`,
                    background: data.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                  }} />
                </>
              ) : (
                <div className="cal-none">No Trades</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- page ------------------------------------------------------------------

export default function Overview({ dataVersion, onImport }) {
  const [d, setD] = useState(null);
  const [importMsg, setImportMsg] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef();
  const navigate = useNavigate();

  useEffect(() => { api('/dashboard').then(setD); }, [dataVersion]);

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setImportMsg('Importing…');
    try {
      const results = await onImport(files);
      setImportMsg(results.map((r) =>
        r.error ? `${r.file}: ❌ ${r.error}`
          : `${r.file}: ${r.kind === 'performance' ? `${r.trades} trades` : `${r.fills} fills → ${r.trades} trades`}${r.skipped ? ` (${r.skipped} skipped/dupes)` : ''}`,
      ).join('  ·  '));
    } catch (e) {
      setImportMsg(`Import failed: ${e.message}`);
    }
  };

  if (!d) return null;
  const empty = d.trades === 0;
  const ratio = d.avgLoss !== 0 ? Math.abs(d.avgWin / d.avgLoss) : null;
  const pfFill = d.profitFactor == null ? 0 : Math.min(6, Math.round(d.profitFactor * 2));
  const scoreColor = d.score >= 75 ? 'var(--green)' : d.score >= 45 ? '#f59e0b' : 'var(--red)';
  const holdFmt = d.avgHoldS == null ? '—'
    : d.avgHoldS < 60 ? `${d.avgHoldS}s`
    : d.avgHoldS < 3600 ? `${(d.avgHoldS / 60).toFixed(0)}m`
    : `${(d.avgHoldS / 3600).toFixed(1)}h`;

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Home</h1>
        <div className="spacer" />
        {d.issues.length > 0 && (
          <div className="banner" onClick={() => navigate('/patterns')}
            title={d.issues.join('\n')}>
            <span className="dot">●</span> {d.issues.length} issue{d.issues.length > 1 ? 's' : ''} detected in your trading <span className="muted">›</span>
          </div>
        )}
      </div>

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handleFiles([...e.dataTransfer.files]); }}
        style={{ marginBottom: 14 }}
      >
        Drop Tradovate CSV exports here (Fills or Performance) — or click to choose
        <input ref={fileRef} type="file" accept=".csv" multiple hidden
          onChange={(e) => { handleFiles([...e.target.files]); e.target.value = ''; }} />
      </div>
      {importMsg && <div className="muted" style={{ marginBottom: 14 }}>{importMsg}</div>}

      {empty ? (
        <div className="panel muted">
          No trades yet. In Tradovate: Reports → Fills (or Performance) → Export CSV, then drop the file above.
        </div>
      ) : (
        <>
          {/* Top stat cards */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
            <div className="panel">
              <div className="stat-label">Net Return</div>
              <div className={`stat-value ${d.totalPnl >= 0 ? 'pos' : 'neg'}`}>{money(d.totalPnl)}</div>
              <Sparkline data={d.equity} />
            </div>
            <div className="panel row" style={{ gap: 14 }}>
              <Donut segments={[
                { value: d.counts.wins, color: 'var(--green)' },
                { value: d.counts.be, color: '#9ca3af' },
                { value: d.counts.losses, color: 'var(--red)' },
              ]}>{fmt(d.winRate)}%</Donut>
              <div>
                <div className="stat-label">Winrate</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <span className="pos">{d.counts.wins}</span> · <span className="muted">{d.counts.be}</span> · <span className="neg">{d.counts.losses}</span>
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="stat-label">Avg P&L <span style={{ float: 'right', fontWeight: 700, color: 'var(--text)' }}>{ratio == null ? '—' : `${fmt(ratio)} : 1`}</span></div>
              <div className={`stat-value ${d.expectancy >= 0 ? 'pos' : 'neg'}`}>{money(d.expectancy)}</div>
              <div style={{ fontSize: 12 }}>
                <span className="pos">{money(d.avgWin)}</span> <span className="neg" style={{ marginLeft: 6 }}>{money(d.avgLoss)}</span>
              </div>
            </div>
            <div className="panel">
              <div className="stat-label">Profit Factor</div>
              <div className="stat-value">{fmt(d.profitFactor)}</div>
              <div className="pf-squares">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="pf-sq" style={i < pfFill ? {
                    background: i < 2 ? 'var(--red)' : i < 4 ? '#f59e0b' : 'var(--green)',
                  } : undefined} />
                ))}
              </div>
            </div>
            <div className="panel row" style={{ gap: 14 }}>
              <Donut segments={[
                { value: d.score, color: scoreColor },
                { value: 100 - d.score, color: '#f3f4f6' },
              ]}>{d.score}</Donut>
              <div>
                <div className="stat-label">Discipline Score</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>revenge · sizing · limits</div>
              </div>
            </div>
          </div>

          {/* Calendar + evaluation */}
          <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginBottom: 14, alignItems: 'start' }}>
            <ProfitCalendar equity={d.equity} />
            <div className="panel">
              <h2>Evaluation</h2>
              <div className="eval-row"><span className="k">Total Number of Trades</span><span className="v">{d.trades}</span></div>
              <div className="eval-row"><span className="k">Avg. Profit per Trading Day</span><span className={`v ${d.avgProfitPerDay >= 0 ? 'pos' : 'neg'}`}>{money(d.avgProfitPerDay)}</span></div>
              <div className="eval-row"><span className="k">Biggest Winner</span><span className="v pos">{money(d.biggestWin)}</span></div>
              <div className="eval-row"><span className="k">Biggest Loser</span><span className="v neg">{money(d.biggestLoss)}</span></div>
              <div className="eval-row"><span className="k">Total Fees</span><span className="v">{money(d.fees)}</span></div>
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
    </>
  );
}
