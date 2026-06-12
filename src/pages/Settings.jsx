import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Settings({ onChanged }) {
  const [settings, setSettings] = useState(null);
  const [products, setProducts] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api('/settings').then(({ settings, products }) => { setSettings(settings); setProducts(products); });
  }, []);

  if (!settings || !products) return null;

  const set = (k, v) => { setSettings((s) => ({ ...s, [k]: v })); setSaved(false); };
  const setProd = (sym, field, v) => {
    setProducts((p) => ({ ...p, [sym]: { ...p[sym], [field]: v } }));
    setSaved(false);
  };

  const save = async () => {
    await api('/settings', { method: 'PATCH', body: { settings, products } });
    setSaved(true);
    onChanged?.();
  };

  const reset = async () => {
    if (!confirm('Delete ALL imported fills and trades? Settings are kept. This cannot be undone.')) return;
    await api('/reset', { method: 'POST' });
    onChanged?.();
  };

  return (
    <>
      <h1>Settings</h1>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Prop account rules (used by the Risk view)</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="muted">Starting balance</label>
          <input type="number" value={settings.start_balance} onChange={(e) => set('start_balance', e.target.value)} />
          <label className="muted">Trailing drawdown</label>
          <input type="number" value={settings.trailing_dd} onChange={(e) => set('trailing_dd', e.target.value)} />
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="muted">
            <input type="checkbox" checked={settings.dd_stops_at_start === '1'}
              onChange={(e) => set('dd_stops_at_start', e.target.checked ? '1' : '0')} />
            {' '}Threshold stops trailing at starting balance (Apex PA style)
          </label>
        </div>
        <div className="row">
          <label className="muted">Personal daily loss limit ($, for the discipline stats)</label>
          <input type="number" value={settings.daily_loss_limit} onChange={(e) => set('daily_loss_limit', e.target.value)} />
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>Instruments</h2>
        <table>
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
        <button className="danger" onClick={reset}>Delete all data</button>
      </div>
    </>
  );
}
