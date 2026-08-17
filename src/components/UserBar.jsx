import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase-init.js';

// Compact sidebar bar that makes the login state explicit: who's signed in
// (display name + email from Firebase Auth) and a sign-out action.
// Self-contained — it subscribes to Firebase directly, so it also works
// outside this app.
//
//   onLogout — called after signOut(auth) resolves (e.g. to reset app state).
export default function UserBar({ onLogout }) {
  const [currentUser, setCurrentUser] = useState(() => auth.currentUser);

  useEffect(() => onAuthStateChanged(auth, (user) => setCurrentUser(user)), []);

  if (!currentUser) return null;

  const displayName = currentUser.displayName?.trim() || currentUser.email?.split('@')[0] || 'Trader';
  const email = currentUser.email || '';
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    try { await signOut(auth); } catch {}
    onLogout?.();
  };

  return (
    <div className="userbar">
      {currentUser.photoURL ? (
        <img className="userbar-avatar" src={currentUser.photoURL} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="userbar-avatar" aria-hidden>{initials}</span>
      )}
      <div className="userbar-meta">
        <span className="userbar-name" title={email}>{displayName}</span>
        <span className="userbar-account" title="Account email">{email || 'No email on file'}</span>
      </div>
      <button type="button" className="userbar-signout" title="Sign out" onClick={handleSignOut}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5M21 12H9" />
        </svg>
      </button>
    </div>
  );
}