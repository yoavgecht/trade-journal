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
        <CartesianGrid stroke="#2a2f3e" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} stroke="#8b91a3" fontSize={11} tickFormatter={xFormat} />
        <YAxis stroke="#8b91a3" fontSize={11} tickFormatter={(v) => `$${v}`} />
        <Tooltip contentStyle={{ background: '#181b24', border: '1px solid #2a2f3e' }}
          formatter={(v) => money(v)} labelFormatter={xFormat} />
        <ReferenceLine y={0} stroke="#8b91a3" />
        <Bar dataKey="pnl" name="P&L">
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#34d399' : '#f87171'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Compare({ title, a, b, aLabel, bLabel, verdict }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <table>
        <thead><tr><th></th><th>{aLabel}</th><th>{bLabel}</th></tr></thead>
        <tbody>
          <tr><td>Trades</td><td>{a.trades}</td><td>{b.trades}</td></tr>
          <tr><td>Win rate</td><td>{a.winRate == null ? '—' : `${a.winRate}%`}</td><td>{b.winRate == null ? '—' : `${b.winRate}%`}</td></tr>
          <tr>
            <td>Avg P&L / trade</td>
            <td className={a.avgPnl >= 0 ? 'pos' : 'neg'}>{money(a.avgPnl)}</td>
            <td className={b.avgPnl >= 0 ? 'pos' : 'neg'}>{money(b.avgPnl)}</td>
          </tr>
          <tr>
            <td>Total P&L</td>
            <td className={a.pnl >= 0 ? 'pos' : 'neg'}>{money(a.pnl)}</td>
            <td className={b.pnl >= 0 ? 'pos' : 'neg'}>{money(b.pnl)}</td>
          </tr>
        </tbody>
      </table>
      {verdict && <div className="muted" style={{ marginTop: 8 }}>{verdict}</div>}
    </div>
  );
}

export default function Patterns({ dataVersion }) {
  const [p, setP] = useState(null);
  useEffect(() => { api('/patterns').then(setP); }, [dataVersion]);
  if (!p) return null;

  const revenge = p.revenge, normal = p.nonRevenge;
  const revengeVerdict = revenge.trades === 0
    ? 'No revenge-pattern trades detected (entered within 5 min of a losing exit).'
    : revenge.avgPnl < (normal.avgPnl ?? 0)
      ? `⚠️ Trades fired within 5 minutes of a loss average ${money(revenge.avgPnl)} vs ${money(normal.avgPnl)} otherwise — that pause matters.`
      : 'Quick re-entries after losses are not hurting you so far.';

  const sizeVerdict = p.avgSizeAfterLoss != null && p.avgSizeOther != null
    ? p.avgSizeAfterLoss > p.avgSizeOther * 1.15
      ? `⚠️ Average size after a loss is ${fmt(p.avgSizeAfterLoss)} vs ${fmt(p.avgSizeOther)} otherwise — you size UP after losing.`
      : `Size after a loss (${fmt(p.avgSizeAfterLoss)}) stays in line with normal (${fmt(p.avgSizeOther)}).`
    : null;

  return (
    <>
      <h1>Patterns</h1>
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

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
        <Compare title="Revenge trading (entry ≤5 min after a loss)"
          a={revenge} b={normal} aLabel="After-loss quick entries" bLabel="All other trades"
          verdict={revengeVerdict} />
        <div className="panel">
          <h2>Discipline</h2>
          <table>
            <tbody>
              <tr><td>Avg size after a loss</td><td>{fmt(p.avgSizeAfterLoss)}</td></tr>
              <tr><td>Avg size otherwise</td><td>{fmt(p.avgSizeOther)}</td></tr>
              <tr><td>Avg trades on green days</td><td>{fmt(p.avgTradesGreenDay)}</td></tr>
              <tr><td>Avg trades on red days</td><td>{fmt(p.avgTradesRedDay)}</td></tr>
              <tr><td>Days personal loss limit (${fmt(p.dailyLossLimit)}) was breached</td><td>{p.breachDays}</td></tr>
              <tr>
                <td>P&L from trading PAST the breach</td>
                <td className={p.lossAfterBreach >= 0 ? 'pos' : 'neg'}>{money(p.lossAfterBreach)}</td>
              </tr>
            </tbody>
          </table>
          {sizeVerdict && <div className="muted" style={{ marginTop: 8 }}>{sizeVerdict}</div>}
          {p.avgTradesRedDay != null && p.avgTradesGreenDay != null && p.avgTradesRedDay > p.avgTradesGreenDay * 1.3 && (
            <div className="muted" style={{ marginTop: 4 }}>
              ⚠️ Red days average {fmt(p.avgTradesRedDay)} trades vs {fmt(p.avgTradesGreenDay)} on green days — losing days are also overtrading days.
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Cost of tagged mistakes</h2>
        {p.mistakeTags.length === 0 ? (
          <div className="muted">Tag mistakes on trades (Trades tab) and their dollar cost shows up here.</div>
        ) : (
          <table>
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
