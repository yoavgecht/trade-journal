import React, { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, money, fmt } from '../api.js';

function Stat({ label, value, signed }) {
  const cls = signed == null ? '' : signed >= 0 ? 'pos' : 'neg';
  return (
    <div className="panel">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${cls}`}>{value}</div>
    </div>
  );
}

export default function Overview({ dataVersion, onImport }) {
  const [sum, setSum] = useState(null);
  const [eq, setEq] = useState([]);
  const [importMsg, setImportMsg] = useState(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    api('/summary').then(setSum);
    api('/equity').then(setEq);
  }, [dataVersion]);

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

  if (!sum) return null;
  const empty = sum.trades === 0;

  return (
    <>
      <h1>Overview</h1>

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handleFiles([...e.dataTransfer.files]); }}
        style={{ marginBottom: 18 }}
      >
        Drop Tradovate CSV exports here (Fills or Performance) — or click to choose
        <input ref={fileRef} type="file" accept=".csv" multiple hidden
          onChange={(e) => { handleFiles([...e.target.files]); e.target.value = ''; }} />
      </div>
      {importMsg && <div className="muted" style={{ marginBottom: 16 }}>{importMsg}</div>}

      {empty ? (
        <div className="panel muted">
          No trades yet. In Tradovate: Reports → Fills (or Performance) → Export CSV, then drop the file above.
        </div>
      ) : (
        <>
          <div className="grid cards" style={{ marginBottom: 18 }}>
            <Stat label="Net P&L" value={money(sum.totalPnl)} signed={sum.totalPnl} />
            <Stat label="Trades" value={fmt(sum.trades)} />
            <Stat label="Win rate" value={`${fmt(sum.winRate)}%`} />
            <Stat label="Profit factor" value={fmt(sum.profitFactor)} signed={sum.profitFactor != null ? sum.profitFactor - 1 : null} />
            <Stat label="Expectancy / trade" value={money(sum.expectancy)} signed={sum.expectancy} />
            <Stat label="Avg win" value={money(sum.avgWin)} signed={1} />
            <Stat label="Avg loss" value={money(sum.avgLoss)} signed={-1} />
            <Stat label="Fees paid" value={money(sum.fees)} />
            <Stat label="Max win streak" value={fmt(sum.maxWinStreak)} />
            <Stat label="Max loss streak" value={fmt(sum.maxLossStreak)} />
          </div>

          <div className="panel" style={{ marginBottom: 14 }}>
            <h2>Equity curve</h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={eq}>
                <CartesianGrid stroke="#2a2f3e" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#8b91a3" fontSize={11} />
                <YAxis stroke="#8b91a3" fontSize={11} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={{ background: '#181b24', border: '1px solid #2a2f3e' }} formatter={(v) => money(v)} />
                <ReferenceLine y={0} stroke="#8b91a3" />
                <Line type="monotone" dataKey="cum" name="Cumulative P&L" stroke="#60a5fa" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="panel" style={{ marginBottom: 14 }}>
            <h2>Daily P&L</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={eq}>
                <CartesianGrid stroke="#2a2f3e" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#8b91a3" fontSize={11} />
                <YAxis stroke="#8b91a3" fontSize={11} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={{ background: '#181b24', border: '1px solid #2a2f3e' }} formatter={(v) => money(v)} />
                <ReferenceLine y={0} stroke="#8b91a3" />
                <Bar dataKey="pnl" name="Day P&L">
                  {eq.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#34d399' : '#f87171'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <h2>By instrument</h2>
            <table>
              <thead><tr><th>Product</th><th>Trades</th><th>Win rate</th><th>P&L</th></tr></thead>
              <tbody>
                {Object.entries(sum.byProduct).map(([p, v]) => (
                  <tr key={p}>
                    <td>{p}</td>
                    <td>{v.trades}</td>
                    <td>{fmt((v.wins / v.trades) * 100)}%</td>
                    <td className={v.pnl >= 0 ? 'pos' : 'neg'}>{money(v.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
