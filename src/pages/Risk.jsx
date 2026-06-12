import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { api, money } from '../api.js';

export default function Risk({ dataVersion }) {
  const [r, setR] = useState(null);
  useEffect(() => { api('/risk').then(setR); }, [dataVersion]);
  if (!r) return null;

  const pct = r.trailingDd > 0 ? Math.max(0, Math.min(100, (r.distance / r.trailingDd) * 100)) : 0;
  const danger = pct < 35;

  return (
    <>
      <h1>Risk — EOD trailing drawdown</h1>
      <div className="grid cards" style={{ marginBottom: 18 }}>
        <div className="panel">
          <div className="stat-label">Balance</div>
          <div className="stat-value">{money(r.currentBalance)}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Liquidation threshold</div>
          <div className="stat-value">{money(r.currentThreshold)}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Distance to blowout</div>
          <div className={`stat-value ${danger ? 'neg' : 'pos'}`}>{money(r.distance)}</div>
        </div>
        <div className="panel">
          <div className="stat-label">Closest it ever got</div>
          <div className="stat-value">{money(r.minDistance)}</div>
        </div>
      </div>

      {r.breachedOn && (
        <div className="panel" style={{ borderColor: '#dc2626', marginBottom: 14 }}>
          ⚠️ The simulated threshold was BREACHED on {r.breachedOn} — by these rules that account is gone.
        </div>
      )}

      <div className="panel">
        <h2>Balance vs trailing threshold ({money(r.trailingDd)} behind EOD high-water mark{r.startBalance ? `, start ${money(r.startBalance)}` : ''})</h2>
        {r.series.length === 0 ? (
          <div className="muted">Import trades to see the simulation. Configure the account rules in Settings.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={r.series}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#6b7280" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb' }} formatter={(v) => money(v)} />
              <Line type="monotone" dataKey="balance" name="EOD balance" stroke="#2563eb" dot={false} strokeWidth={2} />
              <Line type="stepAfter" dataKey="threshold" name="Trailing threshold" stroke="#dc2626" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div className="muted" style={{ marginTop: 8 }}>
          Day-granularity simulation from imported trades (intraday swings between fills aren't visible to the journal).
          The threshold trails end-of-day highs and {'stops at the starting balance (Apex-style)'}.
        </div>
      </div>
    </>
  );
}
