import { onRequest } from 'firebase-functions/v2/https';
import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

// WEB mode: the Express server runs against an in-memory SQLite DB hydrated
// from Firestore (see server/firestore-store.js). Set this BEFORE importing
// the server so db.js/media.js pick the right storage backend.
process.env.TJ_STORAGE = 'firestore';

// AES-256-GCM key for broker passwords at rest in Firestore (see
// firestore-store.js). Ships with the deploy as a gitignored file so the value
// is never in git; anyone with deploy access could read it, so it's a defense
// against casual access to the Firestore data, not a hard security boundary.
const cryptoFile = new URL('./crypto.secret', import.meta.url);
if (fs.existsSync(cryptoFile)) {
  process.env.TJ_CRYPTO_KEY = fs.readFileSync(cryptoFile, 'utf8').trim();
}

const { default: app } = await import('./server/index.js');

// Each user's data root is users/{uid} (the verified Firebase Auth UID); the
// auth layer in server/index.js hydrates the signed-in user's tree into the
// in-memory DB on the first authenticated request.

// Single instance on purpose: the in-memory DB is the working copy, Firestore
// is the durable store behind it (flushed after every write), so more than one
// instance would mean more than one copy of the truth.
export const api = onRequest(
  {
    maxInstances: 1,
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (req, res) => {
    app(req, res);
  },
);

// Auto-provision a profile document (users/{uid}) on every new Firebase Auth
// account. A blocking auth function is the v2 equivalent of the old
// functions.auth.user().onCreate() (firebase-functions v6 has no async user
// events). It runs synchronously as part of account creation, so the profile
// exists before the new user's first client request. The frontend also mirrors
// this record on sign-in; merge:true keeps the two sources in sync without
// clobbering either side's fields. Field names stay within the keys
// firestore.rules allows clients to update, so a later client-side profile
// edit is never rejected for containing them. Errors are logged, not thrown,
// so a profile-write hiccup never blocks account creation itself.
export const createUserProfile = beforeUserCreated(async (event) => {
  const user = event?.data;
  const uid = user?.uid;
  if (!uid) return;
  try {
    const now = user.metadata?.creationTime ? new Date(user.metadata.creationTime) : new Date();
    await getFirestore().collection('users').doc(uid).set(
      {
        uid,
        email: user.email || '',
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  } catch (err) {
    console.error('[createUserProfile] failed to write profile for', uid, err);
  }
});
