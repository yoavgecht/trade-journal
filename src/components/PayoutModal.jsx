import React, { useState } from 'react';
import { api, money } from '../api.js';

// Record a payout the trader received. The amount is subtracted from equity
// (the equity curve steps down) and marked on the profit calendar.
export default function PayoutModal({ payout, onDone, onCancel }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(payout?.available ? String(payout.available) : '');
  const [busy, setBusy] = useState(false);

  const amt = parseFloat(amount);
  const min = payout?.minPayout || 0;
  const canSubmit = !Number.isNaN(amt) && amt > 0 && amt >= min;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    await api('/payouts', { method: 'POST', body: { date, amount: amt, note: null } });
    setBusy(false);
    onDone();
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onCancel}>✕</button>
        <h3>💸 Record a payout</h3>
        <div className="muted" style={{ fontSize: 13, margin: '-6px 0 14px' }}>
          Enter the amount you received — it's subtracted from your equity and marked on the calendar.
        </div>

        <div className="field-row" style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Payout date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Amount received</label>
            <input type="number" min="0" step="0.01" autoFocus value={amount} placeholder="$"
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
        </div>

        {payout && (
          <div className="muted" style={{ fontSize: 12 }}>
            Available to request: <b>{money(payout.available)}</b>
            {payout.maxRequest ? ` · max ${money(payout.maxRequest)}` : ''}{min ? ` · min ${money(min)}` : ''}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button disabled={busy || !canSubmit} onClick={submit}>{busy ? 'Saving…' : 'Record payout'}</button>
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
