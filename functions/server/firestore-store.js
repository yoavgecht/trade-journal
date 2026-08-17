// Durable storage for WEB mode (TJ_STORAGE=firestore). The Express server keeps
// working against an in-memory SQLite DB (db.js); this module is the bridge:
//
//   hydrate()  — cold start: read the Firestore hierarchy back into SQLite.
//   persist()  — after each write: diff the in-memory DB against Firestore and
//                flush only the changed/new/deleted docs (batched, serialized).
//   media      — screenshots/videos live in the default Storage bucket.
//
// Layout (hierarchical; rules deny clients direct access — the function writes
// via the admin SDK, which bypasses rules). accountId = the journal NAME (e.g.
// APEX0023); the numeric journal id stays in the doc as `id`. Each user's data
// root is their Firebase Auth UID (verified from the ID token in
// server/index.js → verifyIdToken) — the users collection only ever holds real
// Firebase uids, and there is no _meta:
//
//   users/{uid}/
//     sessions/{token}                     → sessions
//     library/{itemId}                     → library_items
//     accounts/{name}                      → journals row (snake_case columns kept)
//       brokerPassword                     AES-256-GCM with TJ_CRYPTO_KEY (plaintext only when no key)
//       accountType/status/balance/initialBalance/target/maxDrawdown/disciplineScore/parentAccountId  ← derived
//       equityHistory                      [{ date, equity }]  (array in the doc, per schema)
//       trades/{tradeId}                   → trades row + nested `meta` (trade_meta)
//       fills/{fillId}                     → fills
//       payouts/{payoutId}                 → payouts
//       manualDays/{date}                  → manual_days
//       dayLogs/{date}                     → day_logs
//
// Auth and products are NOT persisted here: Firebase Authentication owns the
// identity record, and `products` is a static shared lookup (NQ/ES/MNQ/MES)
// pre-seeded into the in-memory DB by db.js — neither belongs in a user's tree.
// The account-derived numbers reuse stats.risk() so the stored balance/equity
// curve is byte-for-byte the same thing the dashboard charts.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { db } from './db.js';
import { risk as statsRisk } from './stats.js';

const PROJECT_ID = process.env.GCP_PROJECT || 'trade-journal-d7e7a';
const BUCKET = process.env.STORAGE_BUCKET || 'trade-journal-d7e7a.firebasestorage.app';
const admin = getApps()[0] || initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const firestore = getFirestore(admin);
const bucket = getStorage(admin).bucket();

// --- Firebase Auth -------------------------------------------------------------
// Every /api request carries the Firebase ID token (Bearer / X-Session-Token);
// verification only needs the project's public keys, so it works both in the
// function and in local dev (no service-account file required).
export async function verifyIdToken(token) {
  const dec = await getAuth().verifyIdToken(token);
  return { uid: dec.uid, email: (dec.email || '').trim().toLowerCase() };
}

// --- broker password encryption (AES-256-GCM) ---------------------------------
// At rest in Firestore the password is never plaintext when the deploy ships a
// key (functions/crypto.secret → TJ_CRYPTO_KEY). Format: `v1:<iv>:<ct>:<tag>`.
// Without a key (local mode) we store/read plaintext so dev keeps working.
const KEY = process.env.TJ_CRYPTO_KEY ? Buffer.from(process.env.TJ_CRYPTO_KEY, 'hex') : null;

function encrypt(value) {
  if (KEY === null || value == null || value === '') return value;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
  return `v1:${iv.toString('hex')}:${ct.toString('hex')}:${c.getAuthTag().toString('hex')}`;
}

function decrypt(value) {
  if (value == null || value === '' || KEY === null) return value;
  if (!String(value).startsWith('v1:')) return value; // legacy plaintext
  try {
    const [, ivHex, ctHex, tagHex] = String(value).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
    d.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(ctHex, 'hex')), d.final()]).toString('utf8');
  } catch {
    return value;
  }
}

// --- derived account fields ----------------------------------------------------

const TRADE_META_COLS = ['setup', 'mistakes', 'notes', 'rating', 'screenshots',
  'stop', 'target', 'direction_call', 'entry_timing', 'market_move',
  'intuition', 'mfe_points', 'video'];

function disciplineScore(journalId) {
  const r = db.prepare(
    `SELECT COUNT(rating) AS n, AVG(rating) AS a FROM trade_meta m
     JOIN trades t ON t.id = m.trade_id
     WHERE t.journal_id = ? AND t.clip_only IS NOT 1 AND m.rating IS NOT NULL`,
  ).get(journalId);
  return r.n ? Math.round(((r.a - 1) / 4) * 100) : 0;
}

// --- hydrate: Firestore hierarchy → SQLite --------------------------------------

const tableCols = (table) =>
  new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

const colsCache = new Map();
const colsOf = (table) => (colsCache.get(table) || (colsCache.set(table, tableCols(table)), colsCache.get(table)));

// Keep only the columns the in-memory table actually has (derived/enriched
// Firestore fields are dropped here — they're rebuildable from the raw data).
function clean(table, row) {
  const cols = colsOf(table);
  const out = {};
  for (const k of Object.keys(row || {})) if (cols.has(k)) out[k] = row[k];
  return out;
}

// Hydrate runs on a fresh instance; the only table that already has rows when
// it runs is products (pre-seeded identically by db.js), so a conflict means
// the data is already there → OR IGNORE is safe (and guards against retries
// after a partial rollback).
const insert = (table, row) => {
  const c = Object.keys(row);
  if (!c.length) return;
  db.prepare(`INSERT OR IGNORE INTO ${table} (${c.join(',')}) VALUES (${c.map((x) => `@${x}`).join(',')})`).run(row);
};

// One-time bootstrap: the deploy bundles a snapshot of the data (see
// functions/bootstrap.sqlite, copied from journal.db) so a brand-new uid with no
// Firestore tree still gets the data on their first sign-in. Reads it read-only
// and copies every table into the in-memory DB. After the user's first write the
// tree exists under their uid and this never runs for them again.
function bootstrapFromDisk() {
  const file = fileURLToPath(new URL('../bootstrap.sqlite', import.meta.url));
  if (!fs.existsSync(file)) return 0;
  let boot;
  try {
    boot = new Database(file, { readonly: true });
  } catch {
    return 0;
  }
  let n = 0;
  // journals must load before trades/trade_meta (FK references); column list is
  // the intersection of source and destination schemas so harmless drift in the
  // bundled snapshot (e.g. a dropped column like min_trading_days) can't fail
  // the whole table.
  for (const t of ['users', 'sessions', 'products', 'journals', 'trades',
    'fills', 'trade_meta', 'payouts', 'manual_days', 'day_logs', 'library_items']) {
    try {
      const srcCols = new Set(boot.pragma(`table_info(${t})`).map((c) => c.name));
      const dstCols = new Set(db.pragma(`table_info(${t})`).map((c) => c.name));
      const cols = [...srcCols].filter((c) => dstCols.has(c));
      if (!cols.length) continue;
      const rows = boot.prepare(`SELECT ${cols.join(',')} FROM ${t}`).all();
      if (!rows.length) continue;
      const ins = db.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`);
      for (const r of rows) ins.run(r);
      n += rows.length;
    } catch (e) {
      console.warn(`[store] bootstrap ${t} failed: ${e.message}`);
    }
  }
  boot.close();
  if (n) console.log(`[store] bootstrapped ${n} rows from bundled snapshot`);
  return n;
}

// All inserts run inside one synchronous SQLite transaction: if anything fails
// mid-way the whole hydration rolls back, so a retry never collides with a
// partial restore (UNIQUE/PRIMARY KEY constraints). The async Firestore reads
// happen first; only the inserts are transactional.
export async function hydrateStore(uid) {
  if (!uid) return;
  const root = `users/${uid}`;
  // Per-user tables are rebuilt from the signed-in user's tree (also makes
  // switching uids mid-instance consistent). products is a shared lookup table
  // pre-seeded by db.js and is never persisted per-user; the legacy local
  // `users` row is managed by provisionUser (Firebase owns auth), not Firestore.
  db.exec(`
    DELETE FROM trade_meta;
    DELETE FROM day_logs;
    DELETE FROM manual_days;
    DELETE FROM fills;
    DELETE FROM trades;
    DELETE FROM payouts;
    DELETE FROM library_items;
    DELETE FROM sessions;
    DELETE FROM journals;
  `);

  // No tree for this uid yet → brand-new account starts EMPTY. Its data is
  // created as the user uses the app (challenges, funded, film room, playbook)
  // and persisted to their tree, so every account owns its own data.
  const hasData = (await firestore.collection(`${root}/accounts`).limit(1).get().catch(() => null))?.size
    || (await firestore.collection(`${root}/library`).limit(1).get().catch(() => null))?.size;
  if (!hasData) return;

  const pending = []; // [table, row]

  for (const d of (await firestore.collection(`${root}/sessions`).get()).docs) {
    pending.push(['sessions', clean('sessions', d.data())]);
  }

  for (const a of (await firestore.collection(`${root}/accounts`).get()).docs) {
    const ad = a.data();
    const j = clean('journals', ad);
    if (ad.brokerUsername != null) j.broker_username = ad.brokerUsername;
    j.broker_password = decrypt(ad.brokerPassword ?? null);
    if (ad.parentAccountId != null) j.parent_journal_id = ad.parentAccountId;
    pending.push(['journals', j]);

    const acct = `${root}/accounts/${a.id}`;
    for (const d of (await firestore.collection(`${acct}/trades`).get()).docs) {
      const td = d.data();
      pending.push(['trades', clean('trades', td)]);
      const meta = {};
      for (const c of TRADE_META_COLS) if (td.meta?.[c] !== undefined) meta[c] = td.meta[c];
      if (Object.keys(meta).length) {
        meta.trade_id = td.id;
        pending.push(['trade_meta', meta]);
      }
    }
    for (const d of (await firestore.collection(`${acct}/fills`).get()).docs) {
      pending.push(['fills', clean('fills', d.data())]);
    }
    for (const d of (await firestore.collection(`${acct}/payouts`).get()).docs) {
      pending.push(['payouts', clean('payouts', d.data())]);
    }
    for (const d of (await firestore.collection(`${acct}/manualDays`).get()).docs) {
      pending.push(['manual_days', clean('manual_days', d.data())]);
    }
    for (const d of (await firestore.collection(`${acct}/dayLogs`).get()).docs) {
      pending.push(['day_logs', clean('day_logs', d.data())]);
    }
  }
  for (const d of (await firestore.collection(`${root}/library`).get()).docs) {
    pending.push(['library_items', clean('library_items', d.data())]);
  }

  db.transaction(() => {
    for (const [table, row] of pending) insert(table, row);
  })();
  console.log(`[store] hydrated ${pending.length} rows from ${root}`);
}

// --- persist: SQLite → Firestore (diffed, batched, serialized) ------------------

// Load the signed-in user's tree into the in-memory DB once per instance (the
// in-memory DB holds one user's data at a time; first authenticated request
// decides whose). Called from the auth paths in server/index.js.
let hydratedUid = null;
export async function ensureHydratedFor(uid) {
  if (!uid || hydratedUid === uid) return;
  await hydrateStore(uid);
  hydratedUid = uid;
}

// Serialize snapshots: writes are synchronous in SQLite but the Firestore flush
// is async, so overlapping requests queue here instead of interleaving.
let chain = Promise.resolve();
export function persistStore(user) {
  chain = chain
    .then(() => doPersist(user))
    .catch((e) => {
      console.error('[store] persist failed:', e);
      manifest.clear(); // unknown state → next persist rewrites everything
    });
  return chain;
}

// In-memory change tracker: avoids rewriting unchanged docs on every save. It
// only lives for the lifetime of this instance; a cold start re-writes all.
const manifest = new Map(); // fullPath -> content hash
const hashData = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');

const listIds = async (collectionPath) => {
  try {
    const refs = await firestore.collection(collectionPath).listDocuments();
    return new Set(refs.map((r) => r.id));
  } catch {
    return new Set();
  }
};

async function doPersist(user) {
  const uid = user?.uid;
  if (!uid) return;
  const root = `users/${uid}`;
  const desired = new Map(); // fullPath -> data
  const put = (fullPath, data) => desired.set(fullPath, data);

  for (const s of db.prepare('SELECT * FROM sessions').all()) put(`${root}/sessions/${s.token}`, s);
  for (const l of db.prepare('SELECT * FROM library_items').all()) put(`${root}/library/${l.id}`, l);

  for (const j of db.prepare('SELECT * FROM journals').all()) {
    const acct = `${root}/accounts/${j.name}`;
    const stats = statsRisk(j.id);
    const doc = {};
    for (const [k, v] of Object.entries(j)) {
      if (k === 'broker_password' || k === 'broker_username') continue;
      doc[k] = v;
    }
    doc.brokerUsername = j.broker_username ?? null;
    doc.brokerPassword = encrypt(j.broker_password);
    doc.parentAccountId = j.parent_journal_id ?? null;
    doc.accountType = j.phase === 'funded' ? 'funded' : 'challenge';
    doc.type = doc.accountType;
    doc.status = j.archived ? j.outcome || 'blown' : 'active';
    doc.initialBalance = j.start_balance;
    doc.balance = stats.currentBalance;
    doc.target = j.profit_target;
    doc.targetBalance = stats.targetBalance ?? null;
    doc.maxDrawdown = j.trailing_dd;
    doc.disciplineScore = disciplineScore(j.id);
    doc.equityHistory = stats.series.map((d) => ({ date: d.date, equity: d.balance }));
    put(acct, doc);

    for (const t of db.prepare('SELECT * FROM trades WHERE journal_id = ? ORDER BY id').all(j.id)) {
      const metaRow = db.prepare('SELECT * FROM trade_meta WHERE trade_id = ?').get(t.id);
      const meta = {};
      if (metaRow) for (const c of TRADE_META_COLS) if (metaRow[c] !== undefined) meta[c] = metaRow[c];
      put(`${acct}/trades/${t.id}`, { ...t, meta });
    }
    for (const f of db.prepare('SELECT * FROM fills WHERE journal_id = ? ORDER BY id').all(j.id)) {
      put(`${acct}/fills/${f.id}`, f);
    }
    for (const p of db.prepare('SELECT * FROM payouts WHERE journal_id = ? ORDER BY id').all(j.id)) {
      put(`${acct}/payouts/${p.id}`, p);
    }
    for (const m of db.prepare('SELECT * FROM manual_days WHERE journal_id = ?').all(j.id)) {
      put(`${acct}/manualDays/${m.date}`, m);
    }
    for (const d of db.prepare('SELECT * FROM day_logs WHERE journal_id = ?').all(j.id)) {
      put(`${acct}/dayLogs/${d.date}`, d);
    }
  }

  // Existing docs (ids only) — used to delete what no longer exists.
  const existing = new Map(); // collectionPath -> Set(ids)
  const accountIds = await listIds(`${root}/accounts`);
  existing.set(`${root}/accounts`, accountIds);
  for (const sc of ['trades', 'fills', 'payouts', 'manualDays', 'dayLogs']) {
    for (const aid of accountIds) {
      existing.set(`${root}/accounts/${aid}/${sc}`, await listIds(`${root}/accounts/${aid}/${sc}`));
    }
  }
  existing.set(`${root}/sessions`, await listIds(`${root}/sessions`));
  existing.set(`${root}/library`, await listIds(`${root}/library`));

  let batch = firestore.batch();
  let n = 0;
  const flush = async () => {
    if (n === 0) return;
    await batch.commit();
    batch = firestore.batch();
    n = 0;
  };

  let writes = 0;
  let deletes = 0;
  for (const [fullPath, data] of desired) {
    const h = hashData(data);
    if (manifest.get(fullPath) === h) continue; // unchanged since last flush
    batch.set(firestore.doc(fullPath), data);
    manifest.set(fullPath, h);
    writes++;
    if (++n >= 400) await flush();
  }
  for (const [collectionPath, ids] of existing) {
    for (const id of ids) {
      const fullPath = `${collectionPath}/${id}`;
      if (desired.has(fullPath)) continue;
      batch.delete(firestore.doc(fullPath));
      manifest.delete(fullPath);
      deletes++;
      if (++n >= 400) await flush();
    }
  }
  await flush();
  console.log(`[store] persisted +${writes} -${deletes} (${desired.size} total docs)`);
}

// One-time cleanup of the OLD flat `appdata` layout seeded before the hierarchy.
export async function clearLegacyAppdata() {
  const refs = await firestore.collection('appdata').listDocuments().catch(() => []);
  if (!refs.length) return;
  let batch = firestore.batch();
  let n = 0;
  for (const r of refs) {
    batch.delete(r);
    if (++n >= 400) { await batch.commit(); batch = firestore.batch(); n = 0; }
  }
  await batch.commit();
  console.log(`[store] cleared legacy appdata (${refs.length} docs)`);
}

// --- media --------------------------------------------------------------------

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.m4v': 'video/x-m4v', '.ogg': 'video/ogg', '.ogv': 'video/ogg',
};

// Media (screenshots + Film Room videos) are owned by the signed-in account:
// objects live at users/{uid}/media/{name} so every account has its own film
// room. Files uploaded before scoping sit at the bucket root — reads fall back
// to that legacy path so existing clips keep playing.
const mediaPath = (uid, name) => `users/${uid}/media/${name}`;

const findObject = async (uid, name) => {
  const scoped = bucket.file(mediaPath(uid, name));
  if ((await scoped.getMetadata().catch(() => null)) != null) return scoped;
  const legacy = bucket.file(name);
  if ((await legacy.getMetadata().catch(() => null)) != null) return legacy;
  return null;
};

export async function saveShot(uid, name, buffer) {
  await bucket.file(mediaPath(uid, name)).save(buffer, { contentType: MIME[path.extname(name).toLowerCase()] || 'application/octet-stream' });
}

export async function deleteObject(uid, name) {
  try { await bucket.file(mediaPath(uid, name)).delete(); } catch {}
  try { await bucket.file(name).delete(); } catch {} // legacy root copy
}

export async function signedUploadUrl(uid, filename) {
  const url = await bucket.file(mediaPath(uid, filename)).getSignedUrl({
    action: 'write',
    expires: Date.now() + 15 * 60 * 1000, // 15 min to finish the PUT
    version: 'v4',
  });
  return url[0];
}

// Read-only URL for the Film Room player. Videos are served straight from the
// bucket (not proxied): Cloud Functions cap responses at ~32MB, and clips can
// be hundreds of MB. GCS honors Range headers natively, so seeking still works.
export async function signedReadUrl(uid, filename) {
  const file = (await findObject(uid, filename)) ?? bucket.file(mediaPath(uid, filename));
  const url = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1h; regenerated per request
    version: 'v4',
  });
  return url[0];
}

// Stream a stored object with HTTP Range support (videos need it to seek).
export async function streamObject(req, res, uid, name) {
  const file = (await findObject(uid, name)) ?? bucket.file(mediaPath(uid, name));
  const [meta] = await file.getMetadata().catch(() => [{ size: null }]);
  const size = Number(meta.size);
  if (!Number.isFinite(size) || size <= 0) return res.status(404).end();
  const type = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
  const cache = 'public, max-age=31536000, immutable';

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    let end = m?.[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start > end || end >= size) {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
    res.status(206).set({
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
    });
    file.createReadStream({ start, end }).pipe(res);
  } else {
    res.set({
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
    });
    file.createReadStream().pipe(res);
  }
}
