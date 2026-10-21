import './firebase-init.js'
import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import Overview from './pages/Overview.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Journal from './pages/Journal.jsx';
import Challenge from './pages/Challenge.jsx';
import Analytics from './pages/Analytics.jsx';
import Patterns from './pages/Patterns.jsx';
import Review from './pages/Review.jsx';
import Playbook from './pages/Playbook.jsx';
import Archive from './pages/Archive.jsx';
import Expenses from './pages/Expenses.jsx';
import Payouts from './pages/Payouts.jsx';
import Welcome from './pages/Welcome.jsx';
import Settings from './pages/Settings.jsx';
import { api, setActiveJournalId, browserTz, subscribeInflight } from './api.js';
import { PRESETS, accountPrefix } from './presets.js';
import Dropdown from './components/Dropdown.jsx';
import UserBar from './components/UserBar.jsx';
import {
  authenticate,
  authenticateWithGoogle,
  onAuthSessionChanged,
  requestPasswordReset,
  resendVerificationEmail,
  signOutSession,
} from './firebase-auth.js';

const money0 = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Sidebar nav icons (inline line-SVGs, one per section).
const ico = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
);
const NAV = [
  { to: '/', end: true, label: 'Dashboard', icon: ico(<><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>) },
  { to: '/challenges', label: 'Challenges', icon: ico(<><path d="M6 4h12v3a6 6 0 0 1-12 0V4Z" /><path d="M6 6H4a2 2 0 0 0 2 3M18 6h2a2 2 0 0 1-2 3M9.5 15h5M12 15v3M8 21h8" /></>) },
  { to: '/funded', label: 'Funded', icon: ico(<><circle cx="12" cy="12" r="9" /><path d="M15 9.2a3 2 0 0 0-3-1.4c-1.7 0-3 .9-3 2 0 2.6 6 1.4 6 4 0 1.1-1.3 2-3 2a3 2 0 0 1-3-1.4M12 6v1.6M12 16.4V18" /></>) },
  { to: '/journal', label: 'Daily Journal', icon: ico(<><path d="M5 4a2 2 0 0 1 2-2h11v20H7a2 2 0 0 1-2-2V4Z" /><path d="M9 6h5M9 10h5M9 14h3" /></>) },
  { divider: true },
  { to: '/analytics', label: 'Analytics', icon: ico(<><path d="M5 20V11M12 20V4M19 20v-6M3 20h18" /></>) },
  { to: '/patterns', label: 'Patterns', icon: ico(<><path d="M12 3l1.7 4.1L18 9l-4.3 1.9L12 15l-1.7-4.1L6 9l4.3-1.9L12 3Z" /><path d="M18.5 15l.8 1.9L21 18l-1.7.7-.8 2-.8-2L16 18l1.7-.6.8-2.4Z" /></>) },
  { to: '/review', label: 'Film Room', icon: ico(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3V9Z" /></>) },
  { to: '/playbook', label: 'Playbook', icon: ico(<><path d="M12 5a4 4 0 0 0-4-4H3v16h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5V1h-5a4 4 0 0 0-4 4Z" /><path d="M12 5v16" /></>) },
  { to: '/expenses', label: 'Expenses', icon: ico(<><path d="M6 2h9l3 3v16l-2.4-1.5L13 21l-2.5-1.5L8 21l-2-1.5V2Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>) },
  { to: '/payouts', label: 'Payouts', icon: ico(<><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M16 15h3" /></>) },
  { to: '/archive', label: 'Archive', icon: ico(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></>) },
  { to: '/settings', label: 'Settings', icon: ico(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M4.9 19.1l2.1-2.1M16.9 7.1l2.1-2.1" /></>) },
];

// First-run "Create a Journal" (Edgewonk-style). Markets are fixed to NQ/ES
// futures. A firm preset pre-fills the challenge rules; everything stays
// editable (the Challenge page reads these to score pass/payout progress).
function CreateJournalModal({ onCreated, onClose, blocking, initialPhase }) {
  const isFunded = initialPhase === 'funded';
  // Only presets matching the type the user is adding (challenge vs funded).
  const options = Object.entries(PRESETS).filter(([k, p]) =>
    (isFunded ? p.phase === 'funded' : p.phase !== 'funded') || k === 'custom');
  // Default to the Apex 50K EOD plan (eval or funded); fall back to the first option.
  const preferKey = isFunded ? 'apex-50K-pa' : 'apex-50K-eval';
  const defaultKey = options.some(([k]) => k === preferKey) ? preferKey : options[0][0];
  const [name, setName] = useState('');
  const [suffix, setSuffix] = useState(''); // number typed after a locked firm prefix
  const [presetKey, setPresetKey] = useState(defaultKey);
  const [r, setR] = useState({ ...PRESETS[defaultKey] });
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const applyPreset = (key) => { setPresetKey(key); setR({ ...PRESETS[key] }); };
  const set = (k, v) => setR((cur) => ({ ...cur, [k]: v }));

  // Firms assign a fixed account-id prefix (Apex eval "APEX…", Lucid eval "LFE…",
  // Apex funded "PAAPEX…", Lucid funded "LFF…") — lock it and let the user type only the number. Firms
  // without a known prefix (or Custom) get a plain editable name.
  const prefix = accountPrefix(r.firm, isFunded ? 'funded' : 'eval');
  const finalName = prefix ? `${prefix}${suffix.trim()}` : name.trim();
  const canCreate = prefix ? suffix.trim().length > 0 : name.trim().length > 0;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError('');
    try {
      const j = await api('/journals', { method: 'POST', body: { name: finalName, cost: Number(cost) || 0, ...r } });
      await onCreated(j);
    } catch (err) {
      setError(err.message || 'Failed to create challenge');
    } finally {
      setBusy(false);
    }
  };

  // Read-only rule rows derived from the chosen preset (the firm defines these).
  const ruleRows = [
    ['Account size', money0(r.start_balance)],
    // Min. days to pass is a CONSEQUENCE of the consistency cap (a day can't exceed
    // X% of total profit → you need ≥ ⌈100/X⌉ days; no consistency = 1 day).
    !isFunded && r.profit_target > 0 && ['Min. days to pass', String(r.consistency_pct > 0 ? Math.ceil(100 / r.consistency_pct) : 1)],
    r.profit_target > 0 && ['Profit target', money0(r.profit_target)],
    ['Max drawdown', money0(r.trailing_dd)],
    ['Drawdown type', 'End Of Day'],
    r.daily_loss_limit > 0 && ['Daily loss limit', money0(r.daily_loss_limit)],
    r.consistency_pct > 0 && ['Consistency', `${r.consistency_pct}%`],
    r.max_contracts > 0 && ['Max contracts', `${r.max_contracts} mini / ${r.max_contracts * 10} micro`],
    ['Platform', 'Tradovate'],
    r.min_profit_days > 0 && ['Payout', `${r.min_profit_days} days ≥ ${money0(r.min_profit_day_amount)}`],
  ].filter(Boolean);

  return (
    <div className="modal-overlay">
      <div className="modal">
        {!blocking && <button className="x" onClick={onClose}>✕</button>}
        <h3>New {isFunded ? 'Funded Account' : 'Challenge'}</h3>

        <div className="field">
          <label>{prefix ? `${r.firm} account` : 'Name'}</label>
          {prefix ? (
            <div className="prefix-input">
              <span className="prefix">{prefix}</span>
              <input autoFocus inputMode="numeric" value={suffix} placeholder={isFunded ? 'Sim funded number' : 'Challenge number'}
                onChange={(e) => setSuffix(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && canCreate && create()} />
            </div>
          ) : (
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder={isFunded ? 'e.g. My 50k PA #1' : 'e.g. My 50k Eval #1'}
              onKeyDown={(e) => e.key === 'Enter' && create()} />
          )}
        </div>
        <div className="field">
          <label>Account type</label>
          <Dropdown value={presetKey} onChange={applyPreset}
            options={options.map(([k, p]) => ({ value: k, label: p.label }))} />
        </div>
        {!isFunded && (
          <div className="field">
            <label>Total cost (incl. activation fee)</label>
            <div className="prefix-input">
              <span className="prefix">$</span>
              <input inputMode="decimal" value={cost} placeholder="e.g. 167"
                onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))} />
            </div>
          </div>
        )}

        {presetKey === 'custom' ? (
          /* Custom plan — edit every rule yourself; optional ones toggle on/off. */
          <div className="rules-card">
            <div className="rules-card-head">Custom Rules</div>
            <div className="rules-grid">
              <div className="field"><label>Size ($)</label><input type="number" value={r.start_balance} onChange={(e) => set('start_balance', Number(e.target.value))} /></div>
              <div className="field"><label>Target ($)</label><input type="number" value={r.profit_target} onChange={(e) => set('profit_target', Number(e.target.value))} /></div>
              <div className="field"><label>Max drawdown ($)</label><input type="number" value={r.trailing_dd} onChange={(e) => set('trailing_dd', Number(e.target.value))} /></div>
              <div className="field"><label>Max contracts</label><input type="number" value={r.max_contracts} onChange={(e) => set('max_contracts', Number(e.target.value))} /></div>
              <div className="field">
                <label className="rule-toggle">
                  <span className="switch"><input type="checkbox" checked={r.consistency_pct > 0}
                    onChange={(e) => set('consistency_pct', e.target.checked ? 50 : 0)} /><span className="slider" /></span>
                  Consistency rule
                </label>
                {r.consistency_pct > 0 && <input type="number" value={r.consistency_pct}
                  onChange={(e) => set('consistency_pct', Number(e.target.value))} placeholder="% of total profit" />}
              </div>
              <div className="field">
                <label className="rule-toggle">
                  <span className="switch"><input type="checkbox" checked={r.daily_loss_limit > 0}
                    onChange={(e) => set('daily_loss_limit', e.target.checked ? 1000 : 0)} /><span className="slider" /></span>
                  Daily loss limit
                </label>
                {r.daily_loss_limit > 0 && <input type="number" value={r.daily_loss_limit}
                  onChange={(e) => set('daily_loss_limit', Number(e.target.value))} placeholder="$ per day" />}
              </div>
              <div className="field"><label>Drawdown stops</label>
                <select value={r.dd_stop_mode || 'never'} onChange={(e) => set('dd_stop_mode', e.target.value)}>
                  <option value="never">never (trails peak)</option>
                  <option value="buffer">start + buffer</option>
                  <option value="target">start + target</option>
                </select>
              </div>
              {r.dd_stop_mode === 'buffer' && <div className="field"><label>Buffer ($)</label><input type="number" value={r.dd_buffer ?? 100} onChange={(e) => set('dd_buffer', Number(e.target.value))} /></div>}
            </div>
          </div>
        ) : (
          /* Defined firm plan — rules are fixed, just show them. */
          <div className="rules-card">
            <div className="rules-card-head">Account Rules</div>
            {ruleRows.map(([k, v]) => (
              <div key={k} className="rules-card-row"><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
        )}

        {error && <div className="error-message" style={{ marginTop: 10, color: '#c0392b' }}>{error}</div>}

        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={create} disabled={busy || !canCreate}>Create {isFunded ? 'Funded Account' : 'Challenge'}</button>
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
    // The export's times are in this browser's zone; the server converts to NY.
    fd.append('tz', browserTz());
    try {
      const { results } = await api('/import', { method: 'POST', body: fd });
      onImported();
      if (results.some((r) => r.error)) { setResults(results); setBusy(false); } // keep open on error
      else onClose(); // success → close automatically
    } catch (e) {
      setResults([{ file: 'import', error: e.message }]);
      setBusy(false);
    }
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
        <div style={{ fontSize: 15, lineHeight: 1.55, margin: '2px 0 12px' }}>
          In Tradovate: <b>Reports → Fills</b> (preferred) or <b>Reports → Performance</b> → Export CSV.
        </div>
        <ul className="import-notes">
          <li>Overlapping date ranges are safe to re-import</li>
          <li>Duplicates are skipped</li>
        </ul>
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
                  : `${r.file}: ${r.kind === 'performance' ? `${r.trades} trades` : `${r.fills} fills → ${r.trades} trades`}${r.updated ? `, ${r.updated} recalculated` : ''}${r.skipped ? `, ${r.skipped} dupes/skipped` : ''}${r.otherMarkets ? `, ${r.otherMarkets} non-NQ/ES ignored` : ''}`}
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

function AuthScreen({ needsSetup, onAuthed }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState(needsSetup ? 'register' : 'login');

  useEffect(() => {
    setMode(needsSetup ? 'register' : 'login');
  }, [needsSetup]);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setMessage('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'reset') {
        await requestPasswordReset(email);
        setMessage('Password reset email sent.');
      } else {
        const { user, verificationSent } = await authenticate(mode, email, password, displayName);
        if (verificationSent) setMessage('Verification email sent.');
        onAuthed(user);
      }
    } catch (err) {
      setError(err.message || 'Unable to sign in right now.');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { user } = await authenticateWithGoogle();
      onAuthed(user);
    } catch (err) {
      setError(err.message || 'Unable to sign in with Google.');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'register' ? 'Create your login'
    : mode === 'reset' ? 'Reset password'
    : 'Sign in';

  return (
    <div className="auth-shell">
      <form className="auth-panel" onSubmit={submit}>
        <div className="auth-mark">
          <svg className="logo-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17l5-5 4 3 7-8" /><path d="M16 4h5v5" />
          </svg>
          <span>Trade Journal</span>
        </div>
        <h1>{title}</h1>
        {mode === 'register' && (
          <div className="field">
            <label>Username</label>
            <input autoComplete="username" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. trader_apex" required />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input type="email" autoFocus autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        {mode !== 'reset' && (
          <div className="field">
            <label>Password</label>
            <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Password'} />
          </div>
        )}
        {message && <div className="auth-message">{message}</div>}
        {error && <div className="auth-error">{error}</div>}
        <button className="auth-submit" disabled={busy || !email.trim() || (mode !== 'reset' && password.length < 1) || (mode === 'register' && !displayName.trim())}>
          {busy ? 'Please wait...' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'}
        </button>
        {mode !== 'reset' && (
          <button type="button" className="auth-submit ghost-auth" onClick={google} disabled={busy}>
            Continue with Google
          </button>
        )}
        <button type="button" className="auth-link" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Sign up' : 'Already have an account? Sign in'}
        </button>
        {mode !== 'reset' && (
          <button type="button" className="auth-link" onClick={() => switchMode('reset')}>
            Forgot password?
          </button>
        )}
      </form>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [journals, setJournals] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  // Account switch loader: on while the new account's data is still loading
  // (any API request in flight), shown for at least 350 ms so it never flashes.
  const [switching, setSwitching] = useState(null); // { name, since } | null
  useEffect(() => {
    if (!switching) return;
    let idle = null;
    const unsub = subscribeInflight((n) => {
      clearTimeout(idle);
      if (n > 0) return;
      const wait = Math.max(0, 350 - (Date.now() - switching.since));
      idle = setTimeout(() => setSwitching(null), wait + 120); // + a beat for follow-up requests
    });
    const safety = setTimeout(() => setSwitching(null), 20_000);
    return () => { unsub(); clearTimeout(idle); clearTimeout(safety); };
  }, [switching]);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState('eval');
  const [showImport, setShowImport] = useState(false);
  const [balance, setBalance] = useState(null);
  const [viewingArchived, setViewingArchived] = useState(null); // an archived acct opened for viewing
  const [authMessage, setAuthMessage] = useState('');
  // Light / dark theme — initial value comes from the pre-paint script in index.html.
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    const unsub = onAuthSessionChanged((firebaseUser) => {
      if (cancelled) return;
      if (!firebaseUser) {
        setAuth({ user: null, needsSetup: false });
        setJournals(null);
        setActiveId(null);
        setActiveJournalId(null);
        setBalance(null);
        return;
      }
      api('/me').then((me) => {
        if (!cancelled) setAuth({ ...me, user: { ...firebaseUser, ...(me.user || {}) } });
      }).catch(() => {
        if (!cancelled) setAuth({ user: firebaseUser, needsSetup: false });
      });
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const openCreateModal = (phase = 'eval') => {
    setCreateType(phase);
    setShowCreate(true);
  };

  // Open an archived (passed/blown) account for read-only viewing — its data
  // isn't in the active `journals` list, so keep the object around to resolve
  // `active` and show it in the switcher while it's selected.
  const viewArchived = (j) => { setViewingArchived(j); selectJournal(j.id); navigate('/'); };

  // Load journals; restore the account you were last on (persists across
  // refreshes), else the most-recently-imported, else the first.
  useEffect(() => {
    if (!auth?.user) return;
    api('/journals').then((js) => {
      setJournals(js || []);
      // After a pass, land on the freshly-created funded account (set by Challenge).
      const pending = Number(localStorage.getItem('pendingActive'));
      localStorage.removeItem('pendingActive');
      const pendingJ = pending ? js.find((j) => j.id === pending) : null;
      const byImport = [...(js || [])].filter((j) => j.last_import_at)
        .sort((a, b) => b.last_import_at.localeCompare(a.last_import_at))[0];
      const saved = (js || []).find((j) => j.id === Number(localStorage.getItem('activeJournal')));
      // Persist the account you were on across refreshes: the last-selected
      // account wins, so a refresh keeps you where you were (only fall back to
      // the most-recently-imported / first account on a brand-new session).
      const pick = pendingJ || saved || byImport || (js || [])[0];
      if (pick) selectJournal(pick.id);
    }).catch(() => {
      setJournals([]);
      setActiveId(null);
      setActiveJournalId(null);
    });
  }, [auth?.user]);

  const logout = async () => {
    await signOutSession().catch(() => {});
    setAuth((cur) => ({ user: null, needsSetup: cur?.needsSetup || false }));
    setJournals(null);
    setActiveId(null);
    setActiveJournalId(null);
    setBalance(null);
    navigate('/');
  };

  const sendVerification = async () => {
    setAuthMessage('');
    try {
      await resendVerificationEmail();
      setAuthMessage('Verification email sent.');
    } catch (err) {
      setAuthMessage(err.message || 'Unable to send verification email.');
    }
  };

  // Delete an account (with its data); reassign active if it was the open one.
  const removeJournal = async (a) => {
    if (!confirm(`Delete "${a.name}" and its trades, notes and payouts?\n\nIts Film Room clips are KEPT (they move to the Library). This can't be undone.`)) return false;
    await api(`/journals/${a.id}`, { method: 'DELETE' });
    setViewingArchived((v) => (v && v.id === a.id ? null : v));
    const js = await api('/journals');
    setJournals(js);
    // Always refresh every tab (Challenges/Funded/Archive) — including when the
    // deleted account was the active one and no other active account remains.
    // Without this, the deleted card would stay on screen until a manual refresh.
    setDataVersion((v) => v + 1);
    if (a.id === activeId) {
      if (js[0]) selectJournal(js[0].id); else { setActiveId(null); setActiveJournalId(null); }
    }
    return true;
  };

  const selectJournal = (id) => {
    if (id !== activeId) {
      const j = (journals || []).find((x) => x.id === id) || (viewingArchived?.id === id ? viewingArchived : null);
      setSwitching({ name: j?.name || '', since: Date.now() });
    }
    setActiveId(id);
    setActiveJournalId(id);
    localStorage.setItem('activeJournal', String(id));
    setDataVersion((v) => v + 1);
  };

  // Keep the in-memory journals in sync when a child edits a journal in place
  // (e.g. broker credentials). Without this, `active` stays stale and switching
  // away and back shows the pre-edit values.
  const patchJournalLocal = (id, patch) => {
    setJournals((js) => (js ? js.map((j) => (j.id === id ? { ...j, ...patch } : j)) : js));
    setViewingArchived((v) => (v && v.id === id ? { ...v, ...patch } : v));
  };

  // Sidebar account balance (start + net P&L of active journal).
  useEffect(() => {
    if (!activeId) { setBalance(null); return; } // no account → clear stale balance
    api('/dashboard').then((d) => setBalance(d.startBalance + d.totalPnl - (d.paidOut || 0))).catch(() => setBalance(null));
  }, [activeId, dataVersion]);

  if (auth === null) return null;
  if (!auth.user) return <AuthScreen needsSetup={auth.needsSetup} onAuthed={(user) => setAuth({ user, needsSetup: false })} />;
  if (journals === null) return null;
  const active = journals.find((j) => j.id === activeId)
    || (viewingArchived && viewingArchived.id === activeId ? viewingArchived : null);
  const needsFirstJournal = journals.length === 0;
  const showWelcome = location.pathname === '/' && needsFirstJournal;
  const requiresActive = ['/', '/challenge', '/analytics', '/settings'];
  const showRoutes = !!active || !requiresActive.includes(location.pathname);

  return (
    <div className="layout">
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="logo" onClick={() => navigate('/')} title="Go to Dashboard">
          <svg className="logo-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17l5-5 4 3 7-8" /><path d="M16 4h5v5" />
          </svg>
          <span>Trade Journal</span>
        </div>
        {/* One clean account switcher (the Dashboard follows it). */}
        {(journals.length > 0 || viewingArchived) && (
          <select className="journal-select" value={activeId || ''}
            onChange={(e) => { setViewingArchived(null); selectJournal(Number(e.target.value)); navigate('/'); }}>
            {journals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            {viewingArchived && !journals.some((j) => j.id === viewingArchived.id) && (
              <option value={viewingArchived.id}>{viewingArchived.name} (archived)</option>
            )}
          </select>
        )}
        {active && (
          <div className="sidebar-balance">
            <div className="b">{balance == null ? '—' : `$${balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}</div>
            <div className="l">Account Balance</div>
          </div>
        )}
        <div className="nav-divider" style={{ marginTop: 12 }} />
        <nav>
          {NAV.map((n, i) => n.divider
            ? <div key={i} className="nav-divider" />
            : <NavLink key={n.to} className="nav-link" to={n.to} end={n.end}>{n.icon}{n.label}</NavLink>)}
        </nav>
        <div className="theme-switch" role="button" title="Toggle light / dark mode"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
          <span className={`ts-label ${theme === 'dark' ? 'on' : ''}`}>DARK</span>
          <span className={`ts-track ${theme}`}><span className="ts-knob" /></span>
          <span className={`ts-label ${theme === 'light' ? 'on' : ''}`}>LIGHT</span>
        </div>
        <UserBar onLogout={logout} />
      </aside>
      <main className="main" style={{ position: 'relative' }}>
        {switching && (
          <div className="switch-overlay" role="status" aria-live="polite">
            <div className="switch-bar" />
            <div className="switch-card">
              <div className="switch-spinner" />
              <div>Switching to <b>{switching.name || 'account'}</b>…</div>
            </div>
          </div>
        )}
        {auth.user && auth.user.emailVerified === false && (
          <div className="auth-inline">
            <span>Verify your email to keep account recovery secure.</span>
            <button type="button" onClick={sendVerification}>Send email</button>
            {authMessage && <b>{authMessage}</b>}
          </div>
        )}
        {showWelcome && <Welcome onCreate={openCreateModal} />}
        {showRoutes && (
          <Routes>
            <Route path="/" element={active ? <Overview dataVersion={dataVersion} journal={active} onOpenImport={() => setShowImport(true)} onDataChanged={() => setDataVersion((v) => v + 1)} onJournalPatched={patchJournalLocal} /> : <Welcome onCreate={openCreateModal} />} />
            <Route path="/journal" element={<Journal dataVersion={dataVersion} />} />
            <Route path="/challenges" element={<Portfolio dataVersion={dataVersion} filter="eval"
              onOpen={(id) => { selectJournal(id); navigate('/'); }} onAdd={openCreateModal} onDelete={removeJournal} />} />
            <Route path="/funded" element={<Portfolio dataVersion={dataVersion} filter="funded"
              onOpen={(id) => { selectJournal(id); navigate('/'); }} onAdd={openCreateModal} onDelete={removeJournal} />} />
            <Route path="/challenge" element={active ? <Challenge dataVersion={dataVersion} journal={active} /> : <div className="panel muted" style={{ textAlign: 'center', padding: 40 }}><p style={{ marginBottom: 16 }}>Select an account to view challenge details.</p><button onClick={() => openCreateModal('eval')}>+ Create Challenge</button></div>} />
            <Route path="/analytics" element={active ? <Analytics dataVersion={dataVersion} journal={active} /> : <div className="panel muted">Select an account to view analytics.</div>} />
            <Route path="/patterns" element={<Patterns dataVersion={dataVersion} />} />
            <Route path="/review" element={<Review dataVersion={dataVersion} />} />
            <Route path="/playbook" element={<Playbook />} />
            <Route path="/archive" element={<Archive onView={viewArchived} onDelete={removeJournal} />} />
            <Route path="/expenses" element={<Expenses dataVersion={dataVersion} />} />
            <Route path="/payouts" element={<Payouts dataVersion={dataVersion} />} />
            <Route path="/settings" element={active ? <Settings journal={active} onChanged={(js) => {
              if (js) setJournals(js);
              setDataVersion((v) => v + 1);
            }} onJournalsChanged={async () => {
              const js = await api('/journals');
              setJournals(js);
              if (!js.find((j) => j.id === activeId)) {
                if (js[0]) selectJournal(js[0].id); else { setActiveId(null); setActiveJournalId(null); }
                setDataVersion((v) => v + 1);
              }
            }} /> : <div className="panel muted">Select an account to view settings.</div>} />
          </Routes>
        )}
      </main>

      {showCreate && (
        <CreateJournalModal
          initialPhase={createType}
          onClose={() => setShowCreate(false)}
          onCreated={async (j) => {
            try {
              const js = await api('/journals');
              setJournals(js);
            } catch (e) {
              // If refreshing the list fails (e.g. auth glitch), still add the
              // new journal locally so the user can proceed.
              setJournals((prev) => (prev ? [...prev, j] : [j]));
            }
            setShowCreate(false);
            selectJournal(j.id);
            navigate('/');
          }}
        />
      )}
      {showImport && active && (
        <ImportModal onClose={() => setShowImport(false)} onImported={() => setDataVersion((v) => v + 1)} />
      )}
    </div>
  );
}
