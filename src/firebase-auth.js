import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase-init.js';

const SESSION_KEY = 'trade-journal-session';
const PASSWORD_MIN = 8;

function normalizeUserDocId(value) {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return cleaned ? `user-${cleaned}` : null;
}

function normalizedEmailId(email) {
  return normalizeUserDocId(`email:${email}`) || 'user-email';
}

export function buildUserDocId(email, uid = null) {
  if (uid) return String(uid);
  if (email) return normalizedEmailId(email);
  return 'user-email';
}

function authUserPayload(firebaseUser, token = null) {
  if (!firebaseUser) return null;
  return {
    id: firebaseUser.uid,
    uid: firebaseUser.uid,
    email: firebaseUser.email || '',
    displayName: firebaseUser.displayName || '',
    photoURL: firebaseUser.photoURL || '',
    emailVerified: !!firebaseUser.emailVerified,
    token,
  };
}

async function writeUserProfile(firebaseUser) {
  if (!firebaseUser?.uid) return;
  const normalizedEmail = String(firebaseUser.email || '').trim().toLowerCase();
  const docId = buildUserDocId(normalizedEmail, firebaseUser.uid);
  await setDoc(doc(db, 'users', docId), {
    displayName: firebaseUser.displayName || null,
    email: normalizedEmail,
    photoURL: firebaseUser.photoURL || null,
    userId: docId,
    uid: firebaseUser.uid,
    authUid: firebaseUser.uid,
    // createdAt is set once by the beforeUserCreated function — never resend it
    // here (merge would overwrite it on every sign-in).
    source: 'web',
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function persistSession(user) {
  try {
    if (!user) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify({
      id: user.id || user.uid,
      uid: user.uid || user.id,
      email: user.email,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      emailVerified: !!user.emailVerified,
      // No ID token here: Firebase keeps its own session; api.js asks it for a
      // fresh token per request.
    }));
  } catch {}
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function friendlyAuthError(error) {
  const code = error?.code || '';
  if (code === 'auth/email-already-in-use') return 'That email already has an account. Sign in instead.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Email or password is incorrect.';
  if (code === 'auth/weak-password') return `Use a password with at least ${PASSWORD_MIN} characters.`;
  if (code === 'auth/popup-closed-by-user') return 'The sign-in popup was closed before finishing.';
  if (code === 'auth/unauthorized-domain') return 'This domain is not authorized for Firebase sign-in.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a moment and try again.';
  return error?.message || 'Unable to authenticate right now.';
}

async function verifyBackendSession(token) {
  const apiBase = (import.meta?.env?.VITE_API_URL || '').replace(/\/$/, '');
  const res = await fetch(`${apiBase || ''}/api/auth/login`, {
    method: 'POST',
    credentials: apiBase ? 'include' : 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Unable to validate session.');
  return res.json();
}

export async function getAuthToken(forceRefresh = false) {
  if (!auth.currentUser) return null;
  const token = await auth.currentUser.getIdToken(forceRefresh);
  persistSession(authUserPayload(auth.currentUser, token));
  return token;
}

export async function authenticate(mode, email, password, displayName = '') {
  const normalized = String(email || '').trim().toLowerCase();
  if (mode === 'register' && !String(displayName || '').trim()) {
    throw new Error('Username is required.');
  }
  if (!normalized) throw new Error('Email is required.');
  if (String(password || '').length < (mode === 'register' ? PASSWORD_MIN : 1)) {
    throw new Error(mode === 'register' ? `Use a password with at least ${PASSWORD_MIN} characters.` : 'Password is required.');
  }
  try {
    await setPersistence(auth, browserLocalPersistence);
    const cred = mode === 'register'
      ? await createUserWithEmailAndPassword(auth, normalized, String(password || ''))
      : await signInWithEmailAndPassword(auth, normalized, String(password || ''));
    if (mode === 'register' && displayName.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }
    if (mode === 'register' && !cred.user.emailVerified) {
      await sendEmailVerification(cred.user).catch(() => {});
    }
    const token = await cred.user.getIdToken(true);
    await verifyBackendSession(token);
    const user = authUserPayload(cred.user, token);
    persistSession(user);
    try { await writeUserProfile(cred.user); } catch {}
    return { user, verificationSent: mode === 'register' };
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

export async function authenticateWithGoogle() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    const token = await cred.user.getIdToken(true);
    await verifyBackendSession(token);
    const user = authUserPayload(cred.user, token);
    persistSession(user);
    try { await writeUserProfile(cred.user); } catch {}
    return { user };
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

export async function requestPasswordReset(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('Enter your email address first.');
  try {
    await sendPasswordResetEmail(auth, normalized);
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

export async function resendVerificationEmail() {
  if (!auth.currentUser) throw new Error('Sign in before requesting verification.');
  try {
    await sendEmailVerification(auth.currentUser);
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

// Resolves once Firebase has restored (or confirmed absent) the client session,
// so the first /api call can mint a fresh ID token instead of a stale one.
export function onFirebaseReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });
}

export function onAuthSessionChanged(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      persistSession(null);
      callback(null);
      return;
    }
    try {
      const token = await firebaseUser.getIdToken();
      const user = authUserPayload(firebaseUser, token);
      persistSession(user);
      callback(user); // profile is written on sign-in/register, not on every load
    } catch {
      callback(null);
    }
  });
}

export async function signOutSession() {
  const apiBase = (import.meta?.env?.VITE_API_URL || '').replace(/\/$/, '');
  try {
    await fetch(`${apiBase || ''}/api/auth/logout`, { method: 'POST', credentials: apiBase ? 'include' : 'same-origin' });
  } catch {}
  try {
    await fbSignOut(auth);
  } catch {}
  clearSession();
}
