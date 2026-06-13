import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceLine, Cell,
} from 'recharts';
import { api, money, fmt } from '../api.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PnlBars({ data, xKey, xFormat }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} stroke="#6b7280" fontSize={11} tickFormatter={xFormat} />
        <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => `$${v}`} />
        <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb' }}
          formatter={(v) => money(v)} labelFormatter={xFormat} />
        <ReferenceLine y={0} stroke="#6b7280" />
        <Bar dataKey="pnl" name="P&L">
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#16a34a' : '#dc2626'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Builds ranked plain-language findings from the patterns payload. Each is
// {tone: 'bad'|'good'|'info', text}. Only emits a finding when there's enough
// data to mean something.
function buildFindings(p, totalTrades) {
  const out = [];
  const r = p.revenge, n = p.nonRevenge;

  if (r.trades >= 2 && n.avgPnl != null && r.avgPnl != null && r.avgPnl < n.avgPnl) {
    out.push({ tone: 'bad', cost: r.pnl,
      text: `Revenge trading is costing you. ${r.trades} trades taken within 5 min of a loss averaged ${money(r.avgPnl)} each (vs ${money(n.avgPnl)} otherwise) — ${money(r.pnl)} total. After a loss, step away before re-entering.` });
  }
  if (p.avgSizeAfterLoss != null && p.avgSizeOther != null && p.avgSizeOther > 0 && p.avgSizeAfterLoss > p.avgSizeOther * 1.15) {
    out.push({ tone: 'bad',
      text: `You size UP after losses — ${fmt(p.avgSizeAfterLoss)} contracts vs ${fmt(p.avgSizeOther)} normally. That's how a bad day becomes a blown account. Keep size fixed regardless of the last result.` });
  }
  if (p.breachDays > 0) {
    out.push({ tone: 'bad', cost: p.lossAfterBreach,
      text: `On ${p.breachDays} day(s) you traded PAST your daily loss limit, losing ${money(p.lossAfterBreach)} after the breach point. When the day's limit hits, stop.` });
  }
  if (p.avgTradesRedDay != null && p.avgTradesGreenDay != null && p.avgTradesRedDay > p.avgTradesGreenDay * 1.3) {
    out.push({ tone: 'bad',
      text: `Losing days are overtrading days — ${fmt(p.avgTradesRedDay)} trades on red days vs ${fmt(p.avgTradesGreenDay)} on green. More trades when it's not working digs the hole deeper.` });
  }

  // Worst / best hour and weekday (need ≥3 trades in the bucket to matter).
  const hours = p.byHour.filter((h) => h.trades >= 3);
  if (hours.length) {
    const worst = hours.reduce((a, b) => (b.pnl < a.pnl ? b : a));
    if (worst.pnl < 0) out.push({ tone: 'info', cost: worst.pnl,
      text: `Your worst hour is ${worst.hour}:00 — ${money(worst.pnl)} over ${worst.trades} trades. Worth asking what you're trading then.` });
    const best = hours.reduce((a, b) => (b.pnl > a.pnl ? b : a));
    if (best.pnl > 0 && best.hour !== worst.hour) out.push({ tone: 'good',
      text: `Your best hour is ${best.hour}:00 — ${money(best.pnl)} over ${best.trades} trades. Lean into it.` });
  }
  const dows = p.byDow.filter((d) => d.trades >= 3);
  if (dows.length) {
    const worst = dows.reduce((a, b) => (b.pnl < a.pnl ? b : a));
    if (worst.pnl < 0) out.push({ tone: 'info', cost: worst.pnl,
      text: `${DOW[worst.dow]} is your worst day — ${money(worst.pnl)} over ${worst.trades} trades.` });
  }

  if (p.mistakeTags.length) {
    const worst = p.mistakeTags[0]; // already sorted most-negative first
    if (worst.pnl < 0) out.push({ tone: 'bad', cost: worst.pnl,
      text: `Your most expensive tagged mistake is "${worst.tag}" — ${money(worst.pnl)} across ${worst.trades} trades.` });
  }

  // Sort: bad first, then by dollar cost (most negative first).
  return out.sort((a, b) => (a.tone === 'bad' ? -1 : 1) - (b.tone === 'bad' ? -1 : 1) || (a.cost ?? 0) - (b.cost ?? 0));
}

function insightText(it) {
  const subj = `${it.dim === 'Entry time' ? 'Entries ' : it.dim === 'Hold time' ? 'Holding ' : ''}${it.bucket}`;
  if (it.tone === 'bad') {
    return `${subj}: you lose ${fmt(it.lossRate)}% of the time (${fmt(it.winRate)}% win rate vs ${fmt(it.baseWin)}% overall) over ${it.n} trades — ${money(it.pnl)} total.`;
  }
  return `${subj}: ${fmt(it.winRate)}% win rate (vs ${fmt(it.baseWin)}% overall) over ${it.n} trades — ${money(it.pnl)} total. Lean into it.`;
}

export default function Patterns({ dataVersion }) {
  const [p, setP] = useState(null);
  const [disc, setDisc] = useState(null);
  useEffect(() => {
    api('/patterns').then(setP);
    api('/insights').then(setDisc);
  }, [dataVersion]);
  if (!p || !disc) return null;

  const totalTrades = p.revenge.trades + p.nonRevenge.trades;
  const findings = buildFindings(p, totalTrades);

  return (
    <>
      <h1>Patterns</h1>

      {/* Discovered patterns — the auto-discovery engine */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Discovered patterns — what works, what doesn't</h2>
        {!disc.ready ? (
          <div className="muted">
            Pattern discovery needs at least {disc.need} trades ({disc.total} so far). Import more and the tool will
            slice your trades by entry time, hold time, direction, size, sequence and more — and flag where your win
            rate drops or spikes.
          </div>
        ) : disc.insights.length === 0 ? (
          <div className="muted">No bucket deviates strongly from your {fmt(disc.baseWin)}% baseline yet — no lopsided patterns to report. (More trades sharpen this.)</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>Your overall win rate is {fmt(disc.baseWin)}%. These slices stand out:</div>
            {disc.insights.map((it, i) => (
              <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 15, lineHeight: '20px' }}>{it.tone === 'good' ? '🟢' : '🔴'}</span>
                <span style={{ flex: 1 }}>
                  <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{it.dim}</span><br />
                  {insightText(it)}{it.small && <span className="muted"> (small sample)</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discipline findings */}
      {findings.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h2>Discipline flags</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {findings.map((f, i) => (
              <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 15, lineHeight: '20px' }}>
                  {f.tone === 'bad' ? '🔴' : f.tone === 'good' ? '🟢' : '🔎'}
                </span>
                <span style={{ flex: 1 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
        <div className="panel">
          <h2>P&L by hour of day</h2>
          <PnlBars data={p.byHour} xKey="hour" xFormat={(h) => `${h}:00`} />
        </div>
        <div className="panel">
          <h2>P&L by weekday</h2>
          <PnlBars data={p.byDow} xKey="dow" xFormat={(d) => DOW[d]} />
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Discipline</h2>
        <table style={{ maxWidth: 520 }}>
          <tbody>
            <tr><td>Revenge trades (≤5 min after a loss)</td><td>{p.revenge.trades}</td><td className={p.revenge.pnl >= 0 ? 'pos' : 'neg'}>{money(p.revenge.pnl)}</td></tr>
            <tr><td>All other trades</td><td>{p.nonRevenge.trades}</td><td className={p.nonRevenge.pnl >= 0 ? 'pos' : 'neg'}>{money(p.nonRevenge.pnl)}</td></tr>
            <tr><td>Avg size after a loss</td><td colSpan={2}>{fmt(p.avgSizeAfterLoss)} (vs {fmt(p.avgSizeOther)} normally)</td></tr>
            <tr><td>Avg trades — red vs green days</td><td colSpan={2}>{fmt(p.avgTradesRedDay)} red / {fmt(p.avgTradesGreenDay)} green</td></tr>
            <tr><td>Days past the daily loss limit ({money(p.dailyLossLimit)})</td><td>{p.breachDays}</td><td className={p.lossAfterBreach >= 0 ? 'pos' : 'neg'}>{money(p.lossAfterBreach)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Cost of tagged mistakes</h2>
        {p.mistakeTags.length === 0 ? (
          <div className="muted">Tag mistakes on trades (click a trade → Mistakes) and their dollar cost shows up here, ranked.</div>
        ) : (
          <table style={{ maxWidth: 460 }}>
            <thead><tr><th>Mistake</th><th>Trades</th><th>P&L</th></tr></thead>
            <tbody>
              {p.mistakeTags.map((m) => (
                <tr key={m.tag}>
                  <td>{m.tag}</td><td>{m.trades}</td>
                  <td className={m.pnl >= 0 ? 'pos' : 'neg'}>{money(m.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
