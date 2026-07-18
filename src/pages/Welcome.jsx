import React from 'react';

// First-run landing — shown when there are no accounts yet. Explains the app and
// offers the create actions instead of forcing a blocking modal.
export default function Welcome({ onCreate }) {
  return (
    <div style={{ maxWidth: 720, margin: '5vh auto 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l5-5 4 3 7-8" /><path d="M16 4h5v5" />
        </svg>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}>Welcome to Trade Journal</h1>
      </div>
      <p className="muted" style={{ fontSize: 15, marginTop: 0, lineHeight: 1.6 }}>
        Track your prop-firm evaluations and funded accounts. Import your Tradovate trades and see exactly
        where you stand — growth curve, trailing drawdown, consistency, winning days, and payouts.
      </p>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2>How it works</h2>
        <ol className="welcome-steps">
          <li><b>Create an account.</b> Choose Apex or Lucid — size and rules (target, drawdown, payouts) are filled in — or customise for any other prop firm.</li>
          <li><b>Import your trades.</b> In Tradovate, export a CSV from <b>Reports → Performance</b>, then drop it in with <b>Import Trades</b>.</li>
          <li><b>Track your progress.</b> Pass the challenge, spin up the matching funded account, and manage payouts — all with the numbers computed for you.</li>
        </ol>
      </div>

      <div className="row" style={{ marginTop: 20, gap: 12 }}>
        <button onClick={() => onCreate('eval')} style={{ padding: '11px 18px', fontSize: 15 }}>＋ New Challenge</button>
        <button className="ghost" onClick={() => onCreate('funded')} style={{ padding: '11px 18px', fontSize: 15 }}>＋ New Funded Account</button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Add a <b>challenge</b> — or a <b>funded account</b> if you already have one.
      </p>
    </div>
  );
}
