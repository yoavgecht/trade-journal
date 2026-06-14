import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import Overview from './pages/Overview.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Challenge from './pages/Challenge.jsx';
import Journal from './pages/Journal.jsx';
import Analytics from './pages/Analytics.jsx';
import Patterns from './pages/Patterns.jsx';
import Trades from './pages/Trades.jsx';
import Settings from './pages/Settings.jsx';
import { api, setActiveJournalId } from './api.js';
import { PRESETS } from './presets.js';

const money0 = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// First-run "Create a Journal" (Edgewonk-style). Markets are fixed to NQ/ES
// futures. A firm preset pre-fills the challenge rules; everything stays
// editable (the Challenge page reads these to score pass/payout progress).
function CreateJournalModal({ onCreated, onClose, blocking, initialPhase }) {
  const isFunded = initialPhase === 'funded';
  // Only presets matching the type the user is adding (challenge vs funded).
  const options = Object.entries(PRESETS).filter(([k, p]) =>
    (isFunded ? p.phase === 'funded' : p.phase !== 'funded') || k === 'custom');
  const defaultKey = options[0][0];
  const [name, setName] = useState('');
  const [presetKey, setPresetKey] = useState(defaultKey);
  const [r, setR] = useState({ ...PRESETS[defaultKey] });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyPreset = (key) => { setPresetKey(key); setR({ ...PRESETS[key] }); };
  const set = (k, v) => setR((cur) => ({ ...cur, [k]: v }));

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const j = await api('/journals', { method: 'POST', body: { name: name.trim(), deposit_date: date, ...r } });
    setBusy(false);
    onCreated(j);
  };

  // Read-only rule rows derived from the chosen preset (the firm defines these).
  const ruleRows = [
    ['Account size', money0(r.start_balance)],
    r.profit_target > 0 && ['Profit target', money0(r.profit_target)],
    ['Max drawdown (EOD)', money0(r.trailing_dd)],
    r.daily_loss_limit > 0 && ['Daily loss limit', money0(r.daily_loss_limit)],
    r.consistency_pct > 0 && ['Consistency', `${r.consistency_pct}%`],
    r.max_contracts > 0 && ['Max contracts', `${r.max_contracts} mini`],
    ['Drawdown stops', r.dd_stop_mode === 'never' ? 'never (trails peak)' : r.dd_stop_mode === 'target' ? 'at start + target' : `at start + ${money0(r.dd_buffer)}`],
    r.min_profit_days > 0 && ['Payout', `${r.min_profit_days} days ≥ ${money0(r.min_profit_day_amount)}`],
  ].filter(Boolean);

  return (
    <div className="modal-overlay">
      <div className="modal">
        {!blocking && <button className="x" onClick={onClose}>✕</button>}
        <h3>New {isFunded ? 'Funded Account' : 'Challenge'}</h3>

        <div className="field">
          <label>Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder={isFunded ? 'e.g. Apex 50k PA #1' : 'e.g. Apex 50k Eval #1'}
            onKeyDown={(e) => e.key === 'Enter' && create()} />
        </div>
        <div className="field">
          <label>Account</label>
          <select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
            {options.map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Start date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {/* The preset already defines the rules — show them, don't ask. */}
        <div className="rules-card">
          <div className="rules-card-head">Account Rules <span className="market-chip" style={{ marginLeft: 8 }}>NQ / ES</span></div>
          {ruleRows.map(([k, v]) => (
            <div key={k} className="rules-card-row"><span>{k}</span><b>{v}</b></div>
          ))}
        </div>

        <button className="link-btn" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? '▾ Hide custom rules' : '▸ Customize rules (advanced)'}
        </button>
        {advanced && (
          <div className="field-row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <div className="field"><label>Size ($)</label><input type="number" value={r.start_balance} onChange={(e) => set('start_balance', Number(e.target.value))} /></div>
            <div className="field"><label>Target ($)</label><input type="number" value={r.profit_target} onChange={(e) => set('profit_target', Number(e.target.value))} /></div>
            <div className="field"><label>Max DD ($)</label><input type="number" value={r.trailing_dd} onChange={(e) => set('trailing_dd', Number(e.target.value))} /></div>
            <div className="field"><label>DLL ($)</label><input type="number" value={r.daily_loss_limit} onChange={(e) => set('daily_loss_limit', Number(e.target.value))} /></div>
            <div className="field"><label>Consistency (%)</label><input type="number" value={r.consistency_pct} onChange={(e) => set('consistency_pct', Number(e.target.value))} /></div>
            <div className="field"><label>Max contracts</label><input type="number" value={r.max_contracts} onChange={(e) => set('max_contracts', Number(e.target.value))} /></div>
            <div className="field"><label>DD stops</label>
              <select value={r.dd_stop_mode || 'never'} onChange={(e) => set('dd_stop_mode', e.target.value)}>
                <option value="never">never (trails peak)</option>
                <option value="buffer">start + buffer</option>
                <option value="target">start + target</option>
              </select>
            </div>
            {r.dd_stop_mode === 'buffer' && <div className="field"><label>Buffer ($)</label><input type="number" value={r.dd_buffer ?? 100} onChange={(e) => set('dd_buffer', Number(e.target.value))} /></div>}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={create} disabled={busy || !name.trim()}>Create {isFunded ? 'Funded Account' : 'Challenge'}</button>
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
  const navigate = useNavigate();

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
          <NavLink className="nav-link" to="/accounts">Accounts</NavLink>
          <NavLink className="nav-link" to="/" end>Home</NavLink>
          <NavLink className="nav-link" to="/challenge">Challenge</NavLink>
          <NavLink className="nav-link" to="/journal">Daily Journal</NavLink>
          <NavLink className="nav-link" to="/analytics">Analytics</NavLink>
          <NavLink className="nav-link" to="/patterns">Patterns</NavLink>
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
            <Route path="/journal" element={<Journal dataVersion={dataVersion} />} />
            <Route path="/analytics" element={<Analytics dataVersion={dataVersion} journal={active} />} />
            <Route path="/patterns" element={<Patterns dataVersion={dataVersion} />} />
            <Route path="/accounts" element={<Portfolio dataVersion={dataVersion}
              onOpen={(id) => { selectJournal(id); navigate('/'); }}
              onAdd={(phase) => setShowCreate(phase)} />} />
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
