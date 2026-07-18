import React from 'react';
import { money, fmt } from '../api.js';

// ── Line icons (no icon lib on the client, so a small inline set) ────────────
// Each is drawn with currentColor so the tile can tint it via `color`.
const I = {
  trophy: <path d="M6 4h12v3a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V4Zm0 1H3v1a3 3 0 0 0 3 3m12-4h3v1a3 3 0 0 1-3 3M9 15h6M10 15v-4m4 4v-4M8 20h8m-4-2v2" />,
  thumbsdown: <path d="M7 3h9l2 8h-3m-8-8v8l4 8a2 2 0 0 0 2-2v-4h4M7 3H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />,
  trendup: <path d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />,
  trenddown: <path d="M3 7l6 6 4-4 8 8m0 0h-5m5 0v-5" />,
  bars: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  layers: <path d="M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5" />,
  percent: <path d="M19 5 5 19M8.5 8.5a2 2 0 1 1-3 0 2 2 0 0 1 3 0Zm10 10a2 2 0 1 1-3 0 2 2 0 0 1 3 0Z" />,
  target: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />,
};

function Tile({ icon }) {
  return (
    <div className="stat-tile-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
    </div>
  );
}

const Info = ({ tip }) => (
  <svg className="stat-info" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <title>{tip}</title><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
  </svg>
);

// Dashboard "Statistics" panel — the all-time stat grid. Trade figures come
// from the dashboard payload (`d`). Pass/Blown + challenge status live in the
// toggle row above the chart (Overview), not here.
export default function DashboardStats({ d }) {
  const cards = [
    { label: 'Best Trade', value: money(d.biggestWin), cls: 'pos', icon: I.trophy, tip: 'Largest single-trade profit' },
    { label: 'Worst Trade', value: money(d.biggestLoss), cls: 'neg', icon: I.thumbsdown, tip: 'Largest single-trade loss' },
    { label: 'Avg. Win', value: money(d.avgWin), cls: 'pos', icon: I.trendup, tip: 'Average P&L on winning trades' },
    { label: 'Avg. Loss', value: money(d.avgLoss), cls: 'neg', icon: I.trenddown, tip: 'Average P&L on losing trades' },
    { label: 'No. of Trades', value: fmt(d.trades), icon: I.bars, tip: 'Total trades in this account' },
    { label: 'Contracts', value: fmt(d.contracts), icon: I.layers, tip: 'Total contracts traded (sum of size)' },
    { label: 'Win Rate', value: d.winRateNoBe == null ? '—' : `${fmt(d.winRateNoBe)}%`, icon: I.percent, tip: 'Wins ÷ decisive trades (±$10 scratches excluded)' },
    { label: 'Profit Factor', value: fmt(d.profitFactor), icon: I.target, tip: 'Gross profit ÷ gross loss' },
  ];

  return (
    <>
      {/* All-time statistics grid */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: 'var(--text)', textTransform: 'none', fontWeight: 800 }}>Statistics</h2>
          <span className="market-chip" style={{ fontSize: 11 }}>All Time</span>
        </div>
        <div className="stats-grid">
          {cards.map((s) => (
            <div key={s.label} className="stat-tile">
              <Tile icon={s.icon} />
              <div style={{ minWidth: 0 }}>
                <div className="stat-tile-label">{s.label}<Info tip={s.tip} /></div>
                <div className={`stat-tile-value ${s.cls || ''}`}>{s.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
