import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, Cell, Legend,
} from 'recharts';
import { api, money, fmt } from '../api.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const tip = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 };

// Enrich trades with per-day sequence (for after-win/loss + trade-number).
function enrich(trades) {
  const ts = trades.filter((t) => t.exit_time).sort((a, b) => a.exit_time.localeCompare(b.exit_time));
  const byDay = {};
  for (const t of ts) (byDay[t.exit_time.slice(0, 10)] ??= []).push(t);
  for (const d of Object.keys(byDay)) {
    const list = byDay[d].sort((a, b) => (a.entry_time || a.exit_time).localeCompare(b.entry_time || b.exit_time));
    list.forEach((t, i) => { t._idx = i; t._prev = i > 0 ? list[i - 1] : null; });
  }
  return ts;
}

// Dimension definitions: label + bucketing fn + canonical bucket order.
const DIMENSIONS = {
  'Entry hour': {
    of: (t) => t.entry_time ? `${new Date(t.entry_time).getHours()}:00` : null,
    order: (a, b) => parseInt(a) - parseInt(b),
  },
  'Hold time': {
    of: (t) => t.duration_s == null ? null
      : t.duration_s < 60 ? 'under 1m' : t.duration_s < 300 ? '1–5m'
      : t.duration_s < 900 ? '5–15m' : t.duration_s < 3600 ? '15–60m' : 'over 60m',
    order: (a, b) => ['under 1m', '1–5m', '5–15m', '15–60m', 'over 60m'].indexOf(a) - ['under 1m', '1–5m', '5–15m', '15–60m', 'over 60m'].indexOf(b),
  },
  Direction: { of: (t) => t.direction, order: (a) => (a === 'long' ? -1 : 1) },
  Instrument: { of: (t) => t.product, order: (a, b) => a.localeCompare(b) },
  'Position size': {
    of: (t) => t.qty <= 1 ? '1' : t.qty <= 3 ? '2–3' : '4+',
    order: (a, b) => ['1', '2–3', '4+'].indexOf(a) - ['1', '2–3', '4+'].indexOf(b),
  },
  Weekday: { of: (t) => DOW[new Date(t.exit_time).getDay()], order: (a, b) => DOW.indexOf(a) - DOW.indexOf(b) },
  Sequence: {
    of: (t) => !t._prev ? 'first of day' : t._prev.pnl > 0 ? 'after a win' : 'after a loss',
    order: (a, b) => ['first of day', 'after a win', 'after a loss'].indexOf(a) - ['first of day', 'after a win', 'after a loss'].indexOf(b),
  },
  'Trade # of day': {
    of: (t) => t._idx < 2 ? '1st–2nd' : t._idx < 5 ? '3rd–5th' : '6th+',
    order: (a, b) => ['1st–2nd', '3rd–5th', '6th+'].indexOf(a) - ['1st–2nd', '3rd–5th', '6th+'].indexOf(b),
  },
};

function bucketStats(trades, dim) {
  const groups = {};
  for (const t of trades) {
    const b = DIMENSIONS[dim].of(t);
    if (b == null) continue;
    (groups[b] ??= []).push(t);
  }
  return Object.entries(groups).map(([bucket, list]) => {
    const rs = list.filter((t) => t._R != null);
    return {
      bucket,
      n: list.length,
      winRate: Math.round((list.filter((t) => t.pnl > 0).length / list.length) * 100),
      pnl: Math.round(list.reduce((s, t) => s + t.pnl, 0)),
      expectancy: Math.round(list.reduce((s, t) => s + t.pnl, 0) / list.length),
      avgR: rs.length ? Math.round((rs.reduce((s, t) => s + t._R, 0) / rs.length) * 100) / 100 : null,
    };
  }).sort((a, b) => DIMENSIONS[dim].order(a.bucket, b.bucket));
}

export default function Analytics({ dataVersion, journal }) {
  const [raw, setRaw] = useState(null);
  const [products, setProducts] = useState(null);
  const [dim, setDim] = useState('Entry hour');
  const [metric, setMetric] = useState('expectancy'); // expectancy | winRate | pnl | avgR
  // What-if filters
  const [wf, setWf] = useState({ beforeTime: false, beforeHour: 10, longHold: false, holdMin: 15, afterLoss: false, overtrade: false });

  useEffect(() => { api('/trades').then(setRaw); api('/products').then(setProducts); }, [dataVersion]);
  // Attach R-multiple to each trade: risk$ from the per-trade stop, else the
  // journal's default risk. R = pnl / risk$.
  const trades = useMemo(() => {
    if (!raw || !products) return [];
    const ts = enrich(raw);
    const defRisk = journal?.default_risk || 0;
    for (const t of ts) {
      const pv = products[t.product]?.point_value || 0;
      const risk = (t.stop != null && t.entry_price != null && pv)
        ? Math.abs(t.entry_price - t.stop) * pv * (t.qty || 1)
        : defRisk;
      t._R = risk > 0 ? Math.round((t.pnl / risk) * 100) / 100 : null;
    }
    return ts;
  }, [raw, products, journal]);

  if (!raw || !products) return null;
  if (trades.length === 0) return (<><h1>Trade Analytics</h1><div className="panel muted">No trades yet — import a CSV to explore your analytics.</div></>);

  const stats = bucketStats(trades, dim);
  const metricLabel = { expectancy: 'Avg P&L / trade', winRate: 'Win rate %', pnl: 'Total P&L', avgR: 'Avg R-multiple' }[metric];

  // --- R-multiple stats ---
  const rTrades = trades.filter((t) => t._R != null);
  const rWins = rTrades.filter((t) => t.pnl > 0);
  const rLosses = rTrades.filter((t) => t.pnl < 0);
  const avgR = rTrades.length ? rTrades.reduce((s, t) => s + t._R, 0) / rTrades.length : null;
  const totalR = rTrades.reduce((s, t) => s + t._R, 0);
  const avgWinR = rWins.length ? rWins.reduce((s, t) => s + t._R, 0) / rWins.length : null;
  const avgLossR = rLosses.length ? rLosses.reduce((s, t) => s + t._R, 0) / rLosses.length : null;
  const rBuckets = [
    { k: '≤ -2R', t: (r) => r <= -2 }, { k: '-2 to -1R', t: (r) => r > -2 && r <= -1 },
    { k: '-1 to 0R', t: (r) => r > -1 && r < 0 }, { k: '0 to 1R', t: (r) => r >= 0 && r < 1 },
    { k: '1 to 2R', t: (r) => r >= 1 && r < 2 }, { k: '2 to 3R', t: (r) => r >= 2 && r < 3 },
    { k: '3R+', t: (r) => r >= 3 },
  ].map((b) => ({ bucket: b.k, n: rTrades.filter((t) => b.t(t._R)).length }));

  // --- What-if: predicate = should this trade be EXCLUDED? ---
  const excluded = (t) => {
    if (wf.beforeTime && t.entry_time && new Date(t.entry_time).getHours() < wf.beforeHour) return true;
    if (wf.longHold && t.duration_s != null && t.duration_s > wf.holdMin * 60) return true;
    if (wf.afterLoss && t._prev && t._prev.pnl < 0) return true;
    if (wf.overtrade && t._idx >= 5) return true;
    return false;
  };
  let actualCum = 0, adjCum = 0, removed = 0, removedPnl = 0, keptWins = 0, kept = 0;
  const series = trades.map((t, i) => {
    actualCum += t.pnl;
    const ex = excluded(t);
    if (ex) { removed++; removedPnl += t.pnl; } else { adjCum += t.pnl; kept++; if (t.pnl > 0) keptWins++; }
    return { i: i + 1, actual: Math.round(actualCum), adjusted: Math.round(adjCum) };
  });
  const anyFilter = wf.beforeTime || wf.longHold || wf.afterLoss || wf.overtrade;
  const actualNet = Math.round(actualCum);
  const adjNet = Math.round(adjCum);
  const delta = adjNet - actualNet;

  return (
    <>
      <h1>Trade Analytics</h1>

      {/* Per-variable breakdown */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Performance by</h2>
          <select value={dim} onChange={(e) => setDim(e.target.value)}>
            {Object.keys(DIMENSIONS).map((d) => <option key={d}>{d}</option>)}
          </select>
          <div className="spacer" />
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="expectancy">Avg P&L / trade</option>
            <option value="winRate">Win rate %</option>
            <option value="pnl">Total P&L</option>
            <option value="avgR">Avg R-multiple</option>
          </select>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stats} margin={{ top: 10 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
            <XAxis dataKey="bucket" stroke="#6b7280" fontSize={11} />
            <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => metric === 'winRate' ? `${v}%` : metric === 'avgR' ? `${v}R` : `$${v}`} />
            <Tooltip contentStyle={tip} formatter={(v) => metric === 'winRate' ? `${v}%` : metric === 'avgR' ? `${v}R` : money(v)}
              labelFormatter={(b) => { const s = stats.find((x) => x.bucket === b); return `${b} — ${s?.n} trades, ${s?.winRate}% win`; }} />
            <ReferenceLine y={0} stroke="#9ca3af" />
            <Bar dataKey={metric} name={metricLabel}>
              {stats.map((s, i) => (
                <Cell key={i} fill={metric === 'winRate' ? (s.winRate >= 50 ? '#16a34a' : '#dc2626') : (s[metric] >= 0 ? '#16a34a' : '#dc2626')} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>{dim}</th><th>Trades</th><th>Win rate</th><th>Avg P&L</th><th>Total P&L</th></tr></thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.bucket}>
                <td>{s.bucket}</td><td>{s.n}</td>
                <td className={s.winRate >= 50 ? 'pos' : 'neg'}>{s.winRate}%</td>
                <td className={s.expectancy >= 0 ? 'pos' : 'neg'}>{money(s.expectancy)}</td>
                <td className={s.pnl >= 0 ? 'pos' : 'neg'}>{money(s.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* R-multiple analysis */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>R-multiple analysis (risk-normalized)</h2>
        {rTrades.length === 0 ? (
          <div className="muted">
            No R data yet. Add a <b>stop price</b> when you journal a trade (click a trade → Stop price), or set a
            <b> default risk per trade</b> in Settings. R = profit ÷ risk, so a +2R trade made twice what you risked.
          </div>
        ) : (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 10 }}>
              <div><div className="stat-label">Expectancy</div><div className={`stat-value ${avgR >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 18 }}>{avgR >= 0 ? '+' : ''}{fmt(avgR)}R</div><div className="muted" style={{ fontSize: 11 }}>avg per trade</div></div>
              <div><div className="stat-label">Total</div><div className={`stat-value ${totalR >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 18 }}>{totalR >= 0 ? '+' : ''}{fmt(totalR)}R</div></div>
              <div><div className="stat-label">Avg win</div><div className="stat-value pos" style={{ fontSize: 18 }}>+{fmt(avgWinR)}R</div></div>
              <div><div className="stat-label">Avg loss</div><div className="stat-value neg" style={{ fontSize: 18 }}>{fmt(avgLossR)}R</div></div>
              <div><div className="stat-label">Trades with R data</div><div className="stat-value" style={{ fontSize: 18 }}>{rTrades.length}/{trades.length}</div></div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={rBuckets}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="bucket" stroke="#6b7280" fontSize={11} />
                <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={tip} formatter={(v) => `${v} trades`} />
                <Bar dataKey="n" name="Trades">
                  {rBuckets.map((b, i) => <Cell key={i} fill={b.bucket.includes('-') || b.bucket.startsWith('≤') ? '#dc2626' : '#16a34a'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Expectancy in R is the cleanest measure of edge: positive means each trade makes money on average relative to what you risk, independent of size.
            </div>
          </>
        )}
      </div>

      {/* What-if equity simulator */}
      <div className="panel">
        <h2>What-if simulator — your equity if you cut these trades</h2>
        <div className="row" style={{ gap: 18, marginBottom: 10, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={wf.beforeTime} onChange={(e) => setWf({ ...wf, beforeTime: e.target.checked })} />
            Skip entries before
            <input type="number" value={wf.beforeHour} min={0} max={23} style={{ width: 56 }}
              onChange={(e) => setWf({ ...wf, beforeHour: Number(e.target.value) })} />:00
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={wf.longHold} onChange={(e) => setWf({ ...wf, longHold: e.target.checked })} />
            Skip holds over
            <input type="number" value={wf.holdMin} min={1} style={{ width: 56 }}
              onChange={(e) => setWf({ ...wf, holdMin: Number(e.target.value) })} /> min
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={wf.afterLoss} onChange={(e) => setWf({ ...wf, afterLoss: e.target.checked })} />
            Skip trades right after a loss
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={wf.overtrade} onChange={(e) => setWf({ ...wf, overtrade: e.target.checked })} />
            Skip the 6th+ trade of the day
          </label>
        </div>

        {anyFilter && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 10 }}>
            <div><div className="stat-label">Actual net</div><div className={`stat-value ${actualNet >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 18 }}>{money(actualNet)}</div></div>
            <div><div className="stat-label">If you'd skipped them</div><div className={`stat-value ${adjNet >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 18 }}>{money(adjNet)}</div></div>
            <div><div className="stat-label">Difference</div><div className={`stat-value ${delta >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 18 }}>{delta >= 0 ? '+' : ''}{money(delta)}</div></div>
            <div><div className="stat-label">Trades removed</div><div className="stat-value" style={{ fontSize: 18 }}>{removed}</div><div className="muted" style={{ fontSize: 11 }}>{money(removedPnl)} of P&L</div></div>
          </div>
        )}

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={series}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
            <XAxis dataKey="i" stroke="#6b7280" fontSize={11} label={{ value: 'trade #', position: 'insideBottomRight', fontSize: 11, fill: '#6b7280' }} />
            <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => `$${v}`} />
            <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
            <Legend />
            <ReferenceLine y={0} stroke="#9ca3af" />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="#9ca3af" strokeWidth={2} dot={false} />
            {anyFilter && <Line type="monotone" dataKey="adjusted" name="Without those trades" stroke="#16a34a" strokeWidth={2.5} dot={false} />}
          </LineChart>
        </ResponsiveContainer>
        {anyFilter && delta > 0 && (
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            🟢 Cutting those {removed} trades would have turned {money(actualNet)} into {money(adjNet)} — a {money(delta)} swing. That's the cost of that habit.
          </div>
        )}
        {!anyFilter && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Tick a box above to overlay how your equity curve would look without those trades.</div>}
      </div>
    </>
  );
}
