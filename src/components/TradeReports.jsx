import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from 'recharts';
import { api, money, winRatePct } from '../api.js';

// MFFU-style "Trade Reports": Performance / Trade Count / Win Rate as horizontal
// bars, grouped by a selectable dimension (duration / day / week / month) and
// filtered by direction (overall / long / short).
const tip = { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOLD_ORDER = ['0-15s', '15-45s', '45s-1m', '1-2m', '2-5m', '5-10m', '10-30m', '30m-1h', '1-2h', '2-4h', '4-24h'];
function holdBucket(s) {
  if (s == null) return null;
  return s < 15 ? '0-15s' : s < 45 ? '15-45s' : s < 60 ? '45s-1m' : s < 120 ? '1-2m' : s < 300 ? '2-5m'
    : s < 600 ? '5-10m' : s < 1800 ? '10-30m' : s < 3600 ? '30m-1h' : s < 7200 ? '1-2h' : s < 14400 ? '2-4h' : '4-24h';
}
const weekKey = (iso) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const weekLabel = (k) => new Date(k + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); };

// Each grouping: how to key a trade, how to label a key, and (optional) a FIXED
// set of keys so empty buckets still show (e.g. every weekday).
const GROUPS = {
  'Trade Duration': { key: (t) => holdBucket(t.duration_s), label: (k) => k, order: (a, b) => HOLD_ORDER.indexOf(a) - HOLD_ORDER.indexOf(b) },
  Daily: { key: (t) => (new Date(t.exit_time).getDay() + 6) % 7, label: (k) => DAYS[k], fixed: [0, 1, 2, 3, 4, 5, 6] },
  Weekly: { key: (t) => weekKey(t.exit_time), label: weekLabel, order: (a, b) => a.localeCompare(b) },
  Monthly: { key: (t) => t.exit_time.slice(0, 7), label: monthLabel, order: (a, b) => a.localeCompare(b) },
};

function groupStats(trades, groupName) {
  const g = GROUPS[groupName];
  const map = {};
  for (const t of trades) {
    if (!t.exit_time) continue;
    const k = g.key(t);
    if (k == null) continue;
    (map[k] ??= []).push(t);
  }
  const keys = g.fixed ? g.fixed : Object.keys(map).sort(g.order);
  return keys.map((k) => {
    const list = map[k] || [];
    return {
      bucket: g.label(k),
      n: list.length,
      pnl: Math.round(list.reduce((s, t) => s + t.pnl, 0)),
      winRate: list.length ? winRatePct(list) : 0,
    };
  });
}

// Bright, theme-aware color for the axis + value labels so they're easy to read.
const labelColor = () => (typeof document !== 'undefined' && document.documentElement.dataset.theme !== 'light' ? '#e6e8ec' : '#374151');

// Value label just past the RIGHT end of each bar (all bars grow left→right).
const hBarLabel = (fmt, rows, valKey, color) => (props) => {
  const { x, y, width, height, index } = props;
  const row = rows[index];
  if (!row || row._bar == null) return null;
  return (<text x={x + width + 5} y={y + height / 2} fontSize={10} fill={color} textAnchor="start" dominantBaseline="central">{fmt(row[valKey])}</text>);
};

const rico = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75, flexShrink: 0 }}>{p}</svg>
);
const RICON = {
  perf: rico(<><path d="M3 3v18h18" /><path d="M7 14l3-4 3 2 4-6" /></>),
  count: rico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  win: rico(<><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>),
};

function HBars({ title, icon, data, dataKey, fmt, color, domain, catWidth = 58 }) {
  const vals = data.map((d) => Number(d[dataKey]) || 0);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = (hi - lo) || 1;
  // Axis runs min→max; every bar grows from the LEFT edge (base) to its value —
  // so the biggest negative is leftmost/shortest and the biggest positive reaches
  // furthest right (never a two-sided chart). Empty buckets draw nothing.
  const dom = domain || [lo - (lo < 0 ? span * 0.06 : 0), hi + span * 0.16];
  const base = dom[0];
  const rows = data.map((d) => ({ ...d, _bar: d.n > 0 ? [base, Number(d[dataKey]) || 0] : null }));
  const ink = labelColor();
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>{icon}{title}</div>
      <ResponsiveContainer width="100%" height={data.length * 26 + 44}>
        <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 48, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="rgba(128,128,128,0.18)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" orientation="top" domain={dom} tickFormatter={(v) => fmt(Math.round(v))}
            stroke={ink} tick={{ fill: ink, fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="bucket" width={catWidth} stroke={ink} tick={{ fill: ink, fontSize: 10, fontWeight: 600 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tip} cursor={false} formatter={(v, name, e) => fmt(e.payload[dataKey])}
            labelFormatter={(b) => { const s = rows.find((x) => x.bucket === b); return `${b} · ${s?.n} trades`; }} />
          <Bar dataKey="_bar" radius={[6, 6, 6, 6]} barSize={13} label={hBarLabel(fmt, rows, dataKey, ink)}>
            {rows.map((d, i) => <Cell key={i} fill={color(d)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function TradeReports({ trades: tradesProp, dataVersion }) {
  const [fetched, setFetched] = useState(null);
  const [group, setGroup] = useState('Trade Duration');
  const [dir, setDir] = useState('all');
  useEffect(() => { if (!tradesProp) api('/trades').then(setFetched); }, [dataVersion, tradesProp]);

  const trades = tradesProp || fetched;
  if (!trades) return null;

  const filtered = dir === 'all' ? trades : trades.filter((t) => t.direction === dir);
  const stats = groupStats(filtered, group);
  const catW = group === 'Daily' ? 78 : 58;

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Trade Reports</h2>
        <div className="spacer" />
        <div className="unit-tabs">
          {[['all', 'Overall'], ['long', 'Long'], ['short', 'Short']].map(([v, l]) => (
            <button key={v} className={`unit-tab ${dir === v ? 'on' : ''}`} onClick={() => setDir(v)}>{l}</button>
          ))}
        </div>
        <div className="unit-tabs">
          {Object.keys(GROUPS).map((g) => (
            <button key={g} className={`unit-tab ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="muted">No {dir === 'all' ? '' : dir + ' '}trades to report yet.</div>
      ) : (
        <>
          {/* Performance on its own full-width row (MFFU layout) */}
          <HBars title={`Performance By ${group}`} icon={RICON.perf} data={stats} dataKey="pnl" fmt={money} catWidth={catW}
            color={(d) => (d.pnl >= 0 ? '#16a34a' : '#dc2626')} />
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
            <HBars title={`Trade Count By ${group}`} icon={RICON.count} data={stats} dataKey="n" fmt={(v) => v} catWidth={catW}
              color={() => '#60a5fa'} />
            <HBars title={`Win Rate By ${group}`} icon={RICON.win} data={stats} dataKey="winRate" fmt={(v) => `${v}%`} catWidth={catW}
              color={(d) => (d.winRate >= 50 ? '#16a34a' : '#dc2626')} domain={[0, 100]} />
          </div>
        </>
      )}
    </div>
  );
}
