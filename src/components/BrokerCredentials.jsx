import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Tradovate credentials bar — the user stores their broker login here (kept
// locally in the journal DB) with the password masked + copy buttons. The logo
// links out to Tradovate to export the trades CSV.
const eyeOpen = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);
const eyeOff = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.2 6.3A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
);

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <button className="cred-copy" onClick={copy} type="button">
      {done ? '✓ Copied' : (
        <><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg> Copy</>
      )}
    </button>
  );
}

export default function BrokerCredentials({ journal, onImport, onSaved, onChanged }) {
  const [user, setUser] = useState(journal.broker_username || '');
  const [pass, setPass] = useState(journal.broker_password || '');
  const [show, setShow] = useState(false);
  const [showUser, setShowUser] = useState(false);

  // Mirror the latest typed values + which account they belong to into a ref so
  // we can flush unsaved edits to the OUTGOING account on switch. onBlur alone
  // isn't reliable — switching accounts re-syncs the fields before blur fires,
  // so the edit was being lost.
  const live = useRef({ id: journal.id, user, pass, savedUser: user, savedPass: pass });
  live.current.user = user;
  live.current.pass = pass;

  const persist = (id, patch) => {
    api(`/journals/${id}`, { method: 'PATCH', body: patch });
    onSaved?.(id, patch); // keep the parent's journals list in sync (switch-back shows it)
  };

  // Wipe this account's IMPORTED trades (wrong CSV) for a clean re-import. Manual
  // Film Room clips are kept server-side; payouts/notes untouched.
  const resetTrades = async () => {
    if (!window.confirm(
      `Reset imported trades for "${journal.name}"?\n\nThis deletes ALL trades imported from CSV on this account so you can upload a clean file. Your Film Room clips are KEPT. This can't be undone.`
    )) return;
    await api(`/journals/${journal.id}/reset-trades`, { method: 'POST' });
    onChanged?.(); // refresh the dashboard/stats
  };

  // Save whatever changed for the account currently in `live` (blur OR switch).
  const flush = () => {
    const l = live.current;
    const patch = {};
    if (l.user !== l.savedUser) patch.broker_username = l.user;
    if (l.pass !== l.savedPass) patch.broker_password = l.pass;
    if (Object.keys(patch).length) { persist(l.id, patch); l.savedUser = l.user; l.savedPass = l.pass; }
  };

  useEffect(() => { // re-sync when the active account changes
    if (live.current.id === journal.id) return; // first mount / same account
    flush();                                     // save edits to the account we're leaving
    const u = journal.broker_username || '', p = journal.broker_password || '';
    setUser(u); setPass(p); setShow(false); setShowUser(false);
    live.current = { id: journal.id, user: u, pass: p, savedUser: u, savedPass: p };
  }, [journal.id]);

  return (
    <div className="cred-bar panel">
      <a className="cred-brand" href="https://trader.tradovate.com" target="_blank" rel="noopener noreferrer"
        title="Open Tradovate — export your trades CSV, then Import here">
        <svg className="tv-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 3 11.5l9-3 9 3L12 2Z" fill="#4a86ff" />
          <path d="M12 9 3 12l9 10 9-10-9-3Z" fill="#2f63d9" />
        </svg>
        <span>tradovate</span>
      </a>

      <div className="cred-field">
        <label>Username</label>
        <input type={showUser ? 'text' : 'password'} value={user} placeholder="your username" autoComplete="off" spellCheck={false}
          onChange={(e) => setUser(e.target.value)}
          onBlur={flush} />
        <button className="cred-eye" type="button" onClick={() => setShowUser((s) => !s)} title={showUser ? 'Hide' : 'Show'}>
          {showUser ? eyeOff : eyeOpen}
        </button>
        <CopyBtn text={user} />
      </div>

      <div className="cred-field">
        <label>Password</label>
        <input type={show ? 'text' : 'password'} value={pass} placeholder="••••••••" autoComplete="off" spellCheck={false}
          onChange={(e) => setPass(e.target.value)}
          onBlur={flush} />
        <button className="cred-eye" type="button" onClick={() => setShow((s) => !s)} title={show ? 'Hide' : 'Show'}>
          {show ? eyeOff : eyeOpen}
        </button>
        <CopyBtn text={pass} />
      </div>

      {/* Keep uploading trades — active challenges (until passed/blown) + funded accounts. */}
      {onImport && !journal.archived && (
        <button className="cred-import" type="button" onClick={onImport} title="Upload a Tradovate CSV export">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M7 8l5-5 5 5M5 21h14" /></svg>
          Import Trades
        </button>
      )}
      {!journal.archived && (
        <button className="cred-reset" type="button" onClick={resetTrades}
          title="Delete this account's imported trades so you can re-import a clean CSV (Film Room clips are kept)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5" /></svg>
          Reset Trades
        </button>
      )}
    </div>
  );
}
