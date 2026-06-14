import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Settings({ journal, onChanged, onJournalsChanged }) {
  const [form, setForm] = useState(null);
  const [products, setProducts] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({ ...journal });
    api('/products').then(setProducts);
  }, [journal.id]);

  if (!form || !products) return null;

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };
  const setProd = (sym, field, v) => {
    setProducts((p) => ({ ...p, [sym]: { ...p[sym], [field]: v } }));
    setSaved(false);
  };

  const save = async () => {
    await api(`/journals/${journal.id}`, {
      method: 'PATCH',
      body: {
        name: form.name,
        firm: form.firm || null,
        phase: form.phase || 'eval',
        start_balance: Number(form.start_balance),
        profit_target: Number(form.profit_target),
        trailing_dd: Number(form.trailing_dd),
        daily_loss_limit: Number(form.daily_loss_limit),
        consistency_pct: Number(form.consistency_pct),
        consistency_cushion_pct: Number(form.consistency_cushion_pct || 0),
        min_profit_days: Number(form.min_profit_days),
        min_profit_day_amount: Number(form.min_profit_day_amount),
        max_contracts: Number(form.max_contracts),
        min_payout: Number(form.min_payout || 0),
        payout_cap: Number(form.payout_cap || 0),
        max_payouts: Number(form.max_payouts || 0),
        default_risk: Number(form.default_risk || 0),
        dd_stop_mode: form.dd_stop_mode || 'never',
        dd_buffer: Number(form.dd_buffer ?? 100),
      },
    });
    await api('/products', { method: 'PATCH', body: products });
    setSaved(true);
    onChanged(await api('/journals'));
  };

  const resetData = async () => {
    if (!confirm(`Delete ALL imported fills and trades in "${journal.name}"? The journal and its rules are kept. This cannot be undone.`)) return;
    await api('/reset', { method: 'POST' });
    onChanged();
  };

  const deleteJournal = async () => {
    if (!confirm(`Delete the journal "${journal.name}" AND all its data? This cannot be undone.`)) return;
    await api(`/journals/${journal.id}`, { method: 'DELETE' });
    onJournalsChanged();
  };

  return (
    <>
      <h1>Settings — {journal.name}</h1>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Journal</h2>
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Journal Name</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field-row" style={{ maxWidth: 560 }}>
          <div className="field">
            <label>Firm</label>
            <input value={form.firm || ''} onChange={(e) => set('firm', e.target.value)} placeholder="Lucid / Apex / MFFU" />
          </div>
          <div className="field">
            <label>Phase</label>
            <select value={form.phase || 'eval'} onChange={(e) => set('phase', e.target.value)}>
              <option value="eval">Eval / Challenge</option>
              <option value="funded">Funded / PA</option>
            </select>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Challenge rules (the Challenge page scores against these)</h2>
        <div className="field-row" style={{ maxWidth: 720 }}>
          <div className="field">
            <label>Account Size ($)</label>
            <input type="number" value={form.start_balance} onChange={(e) => set('start_balance', e.target.value)} />
          </div>
          <div className="field">
            <label>Profit Target ($, 0=none)</label>
            <input type="number" value={form.profit_target} onChange={(e) => set('profit_target', e.target.value)} />
          </div>
          <div className="field">
            <label>Max Drawdown ($)</label>
            <input type="number" value={form.trailing_dd} onChange={(e) => set('trailing_dd', e.target.value)} />
          </div>
        </div>
        <div className="field-row" style={{ maxWidth: 720 }}>
          <div className="field">
            <label>Daily Loss Limit ($, 0=none)</label>
            <input type="number" value={form.daily_loss_limit} onChange={(e) => set('daily_loss_limit', e.target.value)} />
          </div>
          <div className="field">
            <label>Consistency (%, 0=none)</label>
            <input type="number" value={form.consistency_pct} onChange={(e) => set('consistency_pct', e.target.value)} />
          </div>
          <div className="field">
            <label>Consistency cushion (+pp)</label>
            <input type="number" value={form.consistency_cushion_pct ?? 0} onChange={(e) => set('consistency_cushion_pct', e.target.value)} />
          </div>
        </div>
        <div className="field-row" style={{ maxWidth: 720 }}>
          <div className="field">
            <label>Max contracts (mini)</label>
            <input type="number" value={form.max_contracts} onChange={(e) => set('max_contracts', e.target.value)} />
          </div>
          <div className="field">
            <label>Default risk / trade ($, for R when no stop)</label>
            <input type="number" value={form.default_risk ?? 0} onChange={(e) => set('default_risk', e.target.value)} />
          </div>
          <div className="field" />
        </div>
        <div className="field-row" style={{ maxWidth: 720 }}>
          <div className="field">
            <label>Payout: qualifying days</label>
            <input type="number" value={form.min_profit_days} onChange={(e) => set('min_profit_days', e.target.value)} />
          </div>
          <div className="field">
            <label>…each day ≥ ($)</label>
            <input type="number" value={form.min_profit_day_amount} onChange={(e) => set('min_profit_day_amount', e.target.value)} />
          </div>
          <div className="field">
            <label>Min payout request ($)</label>
            <input type="number" value={form.min_payout ?? 0} onChange={(e) => set('min_payout', e.target.value)} />
          </div>
        </div>
        <div className="field-row" style={{ maxWidth: 720 }}>
          <div className="field">
            <label>Payout cap ($, 0=none)</label>
            <input type="number" value={form.payout_cap ?? 0} onChange={(e) => set('payout_cap', e.target.value)} />
          </div>
          <div className="field">
            <label>Max payouts → live (0=n/a)</label>
            <input type="number" value={form.max_payouts ?? 0} onChange={(e) => set('max_payouts', e.target.value)} />
          </div>
          <div className="field" />
        </div>
        <div className="field-row" style={{ maxWidth: 720 }}>
          <div className="field">
            <label>EOD drawdown stops trailing</label>
            <select value={form.dd_stop_mode || 'never'} onChange={(e) => set('dd_stop_mode', e.target.value)}>
              <option value="never">Never — trails peak forever (Tradovate eval)</option>
              <option value="buffer">At start + buffer (PA / funded)</option>
              <option value="target">At start + profit target (Rithmic/WC eval)</option>
            </select>
          </div>
          <div className="field">
            <label>Buffer ($, for "start + buffer")</label>
            <input type="number" value={form.dd_buffer ?? 100} onChange={(e) => set('dd_buffer', e.target.value)} />
          </div>
          <div className="field" />
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Instruments (NQ / ES futures)</h2>
        <table style={{ maxWidth: 460 }}>
          <thead><tr><th>Symbol</th><th>$ / point</th><th>Round-trip fees ($/contract)</th></tr></thead>
          <tbody>
            {Object.values(products).map((p) => (
              <tr key={p.symbol}>
                <td>{p.symbol}</td>
                <td><input type="number" style={{ width: 90 }} value={p.point_value}
                  onChange={(e) => setProd(p.symbol, 'point_value', e.target.value)} /></td>
                <td><input type="number" step="0.01" style={{ width: 90 }} value={p.fee_rt}
                  onChange={(e) => setProd(p.symbol, 'fee_rt', e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted" style={{ marginTop: 8 }}>
          Fees apply to trades paired from Fills exports (Tradovate fills don't include commissions).
          Re-import after changing fees to recalculate.
        </div>
      </div>

      <div className="row">
        <button onClick={save}>{saved ? 'Saved ✓' : 'Save settings'}</button>
        <div className="spacer" />
        <button className="danger" onClick={resetData}>Delete journal data</button>
        <button className="danger" onClick={deleteJournal}>Delete journal</button>
      </div>
    </>
  );
}
