import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import Overview from './pages/Overview.jsx';
import Challenge from './pages/Challenge.jsx';
import Analytics from './pages/Analytics.jsx';
import Patterns from './pages/Patterns.jsx';
import Risk from './pages/Risk.jsx';
import Trades from './pages/Trades.jsx';
import Settings from './pages/Settings.jsx';
import { api, setActiveJournalId } from './api.js';
import { PRESETS } from './presets.js';

// First-run "Create a Journal" (Edgewonk-style). Markets are fixed to NQ/ES
// futures. A firm preset pre-fills the challenge rules; everything stays
// editable (the Challenge page reads these to score pass/payout progress).
function CreateJournalModal({ onCreated, onClose, blocking, initialPhase }) {
  // Default to a preset matching the type the user clicked "+" on.
  const defaultKey = initialPhase === 'funded' ? 'apex-50k-pa' : 'apex-50k-eval';
  const [name, setName] = useState('');
  const [presetKey, setPresetKey] = useState(defaultKey);
  const [r, setR] = useState({ ...PRESETS[defaultKey] });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const applyPreset = (key) => {
    setPresetKey(key);
    setR({ ...PRESETS[key] });
  };
  const set = (k, v) => setR((cur) => ({ ...cur, [k]: v }));

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const j = await api('/journals', {
      method: 'POST',
      body: { name: name.trim(), deposit_date: date, ...r },
    });
    setBusy(false);
    onCreated(j);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        {!blocking && <button className="x" onClick={onClose}>✕</button>}
        <h3>Create a Journal</h3>
        <h2>General Details</h2>
        <div className="field">
          <label>Journal Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lucid 50k Eval #1" onKeyDown={(e) => e.key === 'Enter' && create()} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Firm preset</label>
            <select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
              {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Markets</label>
            <div style={{ paddingTop: 4 }}><span className="market-chip">Futures — NQ / ES</span></div>
          </div>
        </div>

        <h2 style={{ marginTop: 16 }}>Account & Rules</h2>
        <div className="field-row">
          <div className="field">
            <label>Account Size ($)</label>
            <input type="number" value={r.start_balance} onChange={(e) => set('start_balance', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Profit Target ($)</label>
            <input type="number" value={r.profit_target} onChange={(e) => set('profit_target', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Start Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Max Drawdown ($)</label>
            <input type="number" value={r.trailing_dd} onChange={(e) => set('trailing_dd', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Daily Loss Limit ($, 0=none)</label>
            <input type="number" value={r.daily_loss_limit} onChange={(e) => set('daily_loss_limit', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Consistency (%, 0=none)</label>
            <input type="number" value={r.consistency_pct} onChange={(e) => set('consistency_pct', Number(e.target.value))} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Payout: qualifying days</label>
            <input type="number" value={r.min_profit_days} onChange={(e) => set('min_profit_days', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>…each day ≥ ($)</label>
            <input type="number" value={r.min_profit_day_amount} onChange={(e) => set('min_profit_day_amount', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Max contracts (mini)</label>
            <input type="number" value={r.max_contracts} onChange={(e) => set('max_contracts', Number(e.target.value))} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>EOD drawdown stops trailing</label>
            <select value={r.dd_stop_mode || 'never'} onChange={(e) => set('dd_stop_mode', e.target.value)}>
              <option value="never">Never — trails peak forever (Tradovate eval)</option>
              <option value="buffer">At start + buffer (PA / funded)</option>
              <option value="target">At start + profit target (Rithmic/WC eval)</option>
            </select>
          </div>
          {r.dd_stop_mode === 'buffer' && (
            <div className="field">
              <label>Buffer ($)</label>
              <input type="number" value={r.dd_buffer ?? 100} onChange={(e) => set('dd_buffer', Number(e.target.value))} />
            </div>
          )}
        </div>
        <div className="infobox">Presets are a starting point — verify against your firm's current rules.</div>

        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={create} disabled={busy || !name.trim()}>Create Journal</button>
          {!blocking && <button className="ghost" onClick={onClose}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}

// Edgewonk-style "Import Trades": importer type (Tradovate) + file drop.
function ImportModal({ onImported, onClose }) {
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef();

  const handleFiles = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    try {
      const { results } = await api('/import', { method: 'POST', body: fd });
      setResults(results);
      onImported();
    } catch (e) {
      setResults([{ file: 'import', error: e.message }]);
    }
    setBusy(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose}>✕</button>
        <h3>Import Trades</h3>
        <div className="field">
          <label>Importer Type</label>
          <select disabled><option>Tradovate (CSV export)</option></select>
        </div>
        <div className="infobox">
          In Tradovate: <b>Reports → Fills</b> (preferred) or <b>Reports → Performance</b> → Export CSV.
          Re-importing overlapping date ranges is safe — duplicates are skipped.
          Non-NQ/ES rows are ignored.
        </div>
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onClick={() => fileRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); handleFiles([...e.dataTransfer.files]); }}
        >
          {busy ? 'Importing…' : 'Drop CSV files here — or click to choose'}
          <input ref={fileRef} type="file" accept=".csv" multiple hidden
            onChange={(e) => { handleFiles([...e.target.files]); e.target.value = ''; }} />
        </div>
        {results && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            {results.map((r, i) => (
              <div key={i} className={r.error ? 'neg' : ''}>
                {r.error ? `${r.file}: ${r.error}`
                  : `${r.file}: ${r.kind === 'performance' ? `${r.trades} trades` : `${r.fills} fills → ${r.trades} trades`}${r.skipped ? `, ${r.skipped} dupes/skipped` : ''}${r.otherMarkets ? `, ${r.otherMarkets} non-NQ/ES ignored` : ''}`}
              </div>
            ))}
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [journals, setJournals] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [balance, setBalance] = useState(null);

  // Load journals; restore last active (or first).
  useEffect(() => {
    api('/journals').then((js) => {
      setJournals(js);
      const saved = Number(localStorage.getItem('activeJournal'));
      const pick = js.find((j) => j.id === saved) || js[0];
      if (pick) selectJournal(pick.id);
    });
  }, []);

  const selectJournal = (id) => {
    setActiveId(id);
    setActiveJournalId(id);
    localStorage.setItem('activeJournal', String(id));
    setDataVersion((v) => v + 1);
  };

  // Sidebar account balance (start + net P&L of active journal).
  useEffect(() => {
    if (!activeId) return;
    api('/dashboard').then((d) => setBalance(d.startBalance + d.totalPnl)).catch(() => setBalance(null));
  }, [activeId, dataVersion]);

  if (journals === null) return null;
  const active = journals.find((j) => j.id === activeId);
  const needsFirstJournal = journals.length === 0;

  return (
    <div className="layout">
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="logo">📈 Trade Journal</div>
        {/* Accounts grouped by type: Challenges (evals) and Funded (PA). You can
            run several of each. */}
        <div className="acct-groups">
          {[['Challenges', 'eval'], ['Funded (PA)', 'funded']].map(([title, phase]) => {
            const list = journals.filter((j) => (phase === 'funded' ? j.phase === 'funded' : j.phase !== 'funded'));
            return (
              <div key={phase} className="acct-group">
                <div className="acct-group-head">
                  <span>{title}</span>
                  <button className="acct-add" title={`Add ${title}`} onClick={() => setShowCreate(phase)}>＋</button>
                </div>
                {list.length === 0 && <div className="acct-empty">none yet</div>}
                {list.map((j) => (
                  <div key={j.id} className={`acct-item ${j.id === activeId ? 'on' : ''}`} onClick={() => selectJournal(j.id)}>
                    {j.name}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="sidebar-actions">
          <button onClick={() => setShowImport(true)} disabled={!active}>Import Trades</button>
        </div>
        <div style={{ marginTop: 16 }}>
          <NavLink className="nav-link" to="/" end>Home</NavLink>
          <NavLink className="nav-link" to="/challenge">Challenge</NavLink>
          <NavLink className="nav-link" to="/analytics">Analytics</NavLink>
          <NavLink className="nav-link" to="/patterns">Patterns</NavLink>
          <NavLink className="nav-link" to="/risk">Risk</NavLink>
          <NavLink className="nav-link" to="/trades">Trades</NavLink>
          <NavLink className="nav-link" to="/settings">Settings</NavLink>
        </div>
        <div className="sidebar-balance">
          <div className="b">{balance == null ? '—' : `$${balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</div>
          <div className="l">Account Balance</div>
        </div>
      </aside>
      <main className="main">
        {active && (
          <Routes>
            <Route path="/" element={<Overview dataVersion={dataVersion} journal={active} onOpenImport={() => setShowImport(true)} />} />
            <Route path="/challenge" element={<Challenge dataVersion={dataVersion} journal={active} />} />
            <Route path="/analytics" element={<Analytics dataVersion={dataVersion} journal={active} />} />
            <Route path="/patterns" element={<Patterns dataVersion={dataVersion} />} />
            <Route path="/risk" element={<Risk dataVersion={dataVersion} />} />
            <Route path="/trades" element={<Trades dataVersion={dataVersion} />} />
            <Route path="/settings" element={<Settings journal={active} onChanged={(js) => {
              if (js) setJournals(js);
              setDataVersion((v) => v + 1);
            }} onJournalsChanged={async () => {
              const js = await api('/journals');
              setJournals(js);
              if (!js.find((j) => j.id === activeId)) {
                if (js[0]) selectJournal(js[0].id); else { setActiveId(null); setActiveJournalId(null); }
              }
            }} />} />
          </Routes>
        )}
      </main>

      {(needsFirstJournal || showCreate) && (
        <CreateJournalModal
          blocking={needsFirstJournal}
          initialPhase={typeof showCreate === 'string' ? showCreate : 'eval'}
          onClose={() => setShowCreate(false)}
          onCreated={async (j) => {
            const js = await api('/journals');
            setJournals(js);
            setShowCreate(false);
            selectJournal(j.id);
          }}
        />
      )}
      {showImport && active && (
        <ImportModal onClose={() => setShowImport(false)} onImported={() => setDataVersion((v) => v + 1)} />
      )}
    </div>
  );
}
