// One-time migration of the LOCAL journal (SQLite file + media files) into the
// live Firebase project, so the app runs on the web with its existing data.
//
// How it works (no service account needed):
//   · The deployed function is started with TJ_MIGRATE_SECRET set, which enables
//     two secret-gated routes (server/index.js):
//       POST /api/migrate-seed        → writes journal rows into Firestore
//       POST /api/migrate-upload-url  → returns a signed Storage upload URL
//   · This script reads journal.db, POSTs every table, then PUTs each file in
//     screenshots/ and videos/ straight to Storage via the signed URLs (which
//     is how Film Room clips get up there — they're too big for a function body).
//
// Usage:
//   TJ_MIGRATE_SECRET=<the deploy secret> node scripts/migrate-to-firestore.mjs
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.TJ_URL || 'https://trade-journal-d7e7a.web.app';
const SECRET = process.env.TJ_MIGRATE_SECRET;
if (!SECRET) {
  console.error('set TJ_MIGRATE_SECRET to the value used when deploying the function');
  process.exit(1);
}

const TABLES = ['journals', 'products', 'users', 'payouts', 'fills', 'trades',
  'trade_meta', 'manual_days', 'day_logs', 'library_items', 'sessions'];

const db = new Database(path.join(root, 'journal.db'));

async function post(pathname, body) {
  const res = await fetch(`${BASE}/api${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${pathname} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// 1 · Rows — read every table and push it.
const rows = {};
for (const table of TABLES) {
  rows[table] = db.prepare(`SELECT * FROM ${table}`).all();
  console.log(`  ${table}: ${rows[table].length} rows`);
}
const total = Object.values(rows).reduce((n, r) => n + r.length, 0);
console.log(`Seeding ${total} rows into Firestore…`);
await post('/migrate-seed', { secret: SECRET, rows });
console.log('  done.');

// 2 · Media files — upload each through a signed Storage URL.
async function uploadMedia(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const name of files) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const { url } = await post('/migrate-upload-url', { secret: SECRET, filename: name });
    const buf = fs.readFileSync(full);
    const res = await fetch(url, { method: 'PUT', body: buf });
    if (!res.ok) throw new Error(`PUT ${name} → ${res.status}`);
    console.log(`  uploaded ${name} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  }
}
console.log('Uploading screenshots/…');
await uploadMedia(path.join(root, 'screenshots'));
console.log('Uploading videos/…');
await uploadMedia(path.join(root, 'videos'));

console.log('Migration complete. Clear TJ_MIGRATE_SECRET from the function next.');
