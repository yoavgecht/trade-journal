// Local-only Express server: journals CRUD + CSV import + stats API + (in
// production) the built frontend. Dev runs alongside Vite (proxies /api here).
// Every data endpoint is scoped to a journal (?journal=ID) — one journal per
// prop account.
import express from 'express';
import multer from 'multer';
import Busboy from 'busboy';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getJournal, productMap, runAsUser } from './db.js';
import { importCsv } from './importer.js';
import { summary, equity, patterns, risk, dashboard, challenge, insights, overviewAll, dailyJournal, review, archiveList } from './stats.js';
import { isWeb, saveShot, deleteShot, deleteVideo, uploadUrl, streamShot, streamVideo, shotsDir, videosDir } from './media.js';

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Multipart uploads on the web: the functions-framework drains the request
// stream into req.rawBody before Express runs, so multer's busboy sees nothing
// and req.file ends up empty. Re-parse the buffered body ourselves, exposing
// the same multer-shaped fields (req.file / req.files / req.body). Local mode
// (a real HTTP server) keeps using multer normally.
function webMultipart(field) {
  return (req, res, next) => {
    if (!isWeb) return (field === 'files' ? upload.array(field) : upload.single(field))(req, res, next);
    if (!req.rawBody || !/^multipart\/form-data/i.test(req.headers['content-type'] || '')) {
      req.body = {};
      if (field === 'files') req.files = []; else req.file = undefined;
      return next();
    }
    const fields = {};
    const files = [];
    const bb = Busboy({
      headers: { ...req.headers, 'content-length': String(req.rawBody.length) },
      limits: { fileSize: 20 * 1024 * 1024 },
    });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => files.push({ name, filename: info.filename, mimetype: info.mimeType, buffer: Buffer.concat(chunks) }));
    });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('error', next);
    bb.on('close', () => {
      req.body = fields;
      if (field === 'files') {
        req.files = files.map((f) => ({ originalname: f.filename, mimetype: f.mimetype, buffer: f.buffer }));
      } else {
        const f = files.find((x) => x.name === field);
        req.file = f ? { originalname: f.filename, mimetype: f.mimetype, buffer: f.buffer } : undefined;
      }
      next();
    });
    bb.end(req.rawBody);
  };
}


// --- Auth -------------------------------------------------------------------
// Unified Firebase Auth in BOTH modes: the client signs in with Firebase and
// sends its ID token (Bearer / X-Session-Token) on every /api request. The
// server verifies it with the Admin SDK (public keys only — works without a
// service-account file) and uses the UID as the data root. Email/password and
// session cookies were the pre-Firebase model and are gone.
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// Media <img>/<video> tags can't set Authorization headers, so every authed
// response also stamps an httpOnly same-origin session cookie (re-verified via
// the Firebase ID token on each request). Media stays behind requireAuth.
const SESSION_COOKIE = 'tj_session';
const parseCookies = (req) => {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};
function stampSessionCookie(res, token) {
  if (!token) return;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/api',
    secure: isWeb, // web is HTTPS; localhost is plain http
  });
}

// Verified Firebase identity: { uid, email } or null. The Bearer token is the
// primary channel; the session cookie (for header-less <img>/<video> requests)
// is accepted as a fallback.
async function currentUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers['x-session-token'] || parseCookies(req)[SESSION_COOKIE] || null;
  if (!token) return null;
  try {
    const { verifyIdToken } = await import('./firestore-store.js');
    return await verifyIdToken(token);
  } catch {
    return null;
  }
}

// The local `users` row is the auth record (email synced from the token).
function provisionUser(email) {
  if (userCount() > 0) return;
  db.prepare('INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)')
    .run(email || '', '', '');
}

// Load the user's data into their own DB. A FAILED load must stop the request:
// carrying on with an empty DB would make the next save delete their data.
async function loadUser(user) {
  if (!isWeb) return true;
  const { ensureHydratedFor } = await import('./firestore-store.js');
  try {
    await ensureHydratedFor(user.uid);
    return true;
  } catch (e) {
    console.error('[store] hydrate failed:', e);
    return false;
  }
}

// Everything after this runs against the signed-in user's own DB (runAsUser).
function requireAuth(req, res, next) {
  currentUser(req).then(async (user) => {
    if (!user) return res.status(401).json({ error: 'authentication required' });
    req.user = user;
    const h = req.headers.authorization || '';
    stampSessionCookie(res, h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers['x-session-token'] || null);
    if (!(await loadUser(user))) return res.status(503).json({ error: 'could not load your data — try again' });
    runAsUser(user.uid, () => {
      provisionUser(user.email);
      next();
    });
  });
}

app.get('/api/me', async (req, res) => {
  const user = await currentUser(req);
  const h = req.headers.authorization || '';
  stampSessionCookie(res, h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers['x-session-token'] || null);
  if (!user) return res.json({ user: null, needsSetup: userCount() === 0 });
  if (!(await loadUser(user))) return res.status(503).json({ error: 'could not load your data — try again' });
  runAsUser(user.uid, () => {
    provisionUser(user.email);
    res.json({ user: { id: user.uid, email: user.email }, needsSetup: userCount() === 0 });
  });
});

// The client signs in/up with Firebase Auth itself; these routes just validate
// the resulting ID token so the app (and the users row) is consistent.
async function handleAuth(req, res) {
  try {
    const { verifyIdToken } = await import('./firestore-store.js');
    const user = await verifyIdToken(String(req.body?.token || ''));
    req.user = user;
    if (!(await loadUser(user))) return res.status(503).json({ error: 'could not load your data — try again' });
    runAsUser(user.uid, () => provisionUser(user.email));
    stampSessionCookie(res, String(req.body?.token || ''));
    res.json({ user: { id: user.uid, email: user.email } });
  } catch {
    res.status(401).json({ error: 'invalid session' });
  }
}

app.post('/api/auth/login', handleAuth);
app.post('/api/auth/register', handleAuth);

app.post('/api/auth/logout', (_req, res) => res.json({ ok: true })); // client-side Firebase sign-out

app.use('/api', requireAuth);

// WEB mode: after every successful write, flush the user's in-memory DB to
// Firestore BEFORE the response goes out (see firestore-store.js). Saving after
// the response isn't safe on Cloud Functions gen2: CPU is throttled once the
// response is sent, so the save could stall or be lost. Must be registered
// before the routes so it wraps every /api write.
if (isWeb) {
  const { persistStore } = await import('./firestore-store.js');
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const end = res.end;
    res.end = function (...args) {
      if (res.statusCode < 200 || res.statusCode >= 400) return end.apply(res, args);
      persistStore(req.user).then(
        () => end.apply(res, args),
        () => {
          // Not in Firestore → don't claim success. (The change is still in the
          // user's in-memory DB; the next successful save rewrites everything.)
          res.statusCode = 503;
          res.removeHeader('Content-Length');
          res.removeHeader('ETag');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          end.call(res, JSON.stringify({ error: 'could not save — try again' }));
        },
      );
      return res;
    };
    next();
  });
}

// Resolve a media file to a browser-loadable URL. <img>/<video> tags can't send
// Authorization headers, so the client fetches this (with its token) and uses
// the returned URL directly: a signed Storage URL on the web, a static local
// path in dev.
app.get('/api/media/:name', async (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return res.status(400).json({ error: 'bad media name' });
  if (isWeb) {
    try {
      const { signedReadUrl } = await import('./firestore-store.js');
      return res.json({ url: await signedReadUrl(req.user.uid, name) });
    } catch {
      return res.status(404).json({ error: 'media not found' });
    }
  }
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(name);
  return res.json({ url: `/media/${isImage ? 'screenshots' : 'videos'}/${encodeURIComponent(name)}` });
});


// Film Room clips can be a few hundred MB. Cloud Functions cap request bodies
// at ~32 MB, so clips are uploaded DIRECTLY to Storage: the client asks for an
// upload target (POST /api/uploads/video-start → signed URL on the web, a
// local PUT endpoint in dev), PUTs the file there, then records it with
// POST /api/trades/:id/video. Duration is enforced client-side.

// Resolve + validate the journal on every data route.
function journalId(req, res) {
  const id = Number(req.query.journal);
  if (!id || !getJournal(id)) {
    res.status(400).json({ error: 'missing or unknown ?journal=ID' });
    return null;
  }
  return id;
}

// --- journals ---------------------------------------------------------------
app.get('/api/journals', (_req, res) => {
  // Active accounts only — archived (passed/blown) live in the Archive view.
  res.json(db.prepare('SELECT * FROM journals WHERE COALESCE(archived, 0) = 0 ORDER BY id').all());
});

// Archived accounts (passed/blown) + headline stats, for records/taxes.
app.get('/api/journals/archived', (_req, res) => res.json(archiveList()));

// Cross-account overview (all journals at once) — not journal-scoped.
app.get('/api/overview', (_req, res) => res.json(overviewAll()));

// Expenses: what every account (active AND archived) cost — for tracking spend
// on challenges/activations. Most recent first.
app.get('/api/expenses', (_req, res) => {
  res.json(db.prepare(`SELECT id, name, firm, phase, cost,
    COALESCE(deposit_date, date(created_at)) AS date, archived, outcome
    FROM journals ORDER BY date DESC, id DESC`).all());
});

// Payouts ledger: every payout taken across ALL accounts (with the account it
// came from), most recent first — for the Payouts tab.
app.get('/api/payouts-all', (_req, res) => {
  res.json(db.prepare(`SELECT p.id, p.date, p.amount, p.note, j.name AS account, j.firm, j.id AS journal_id
    FROM payouts p JOIN journals j ON j.id = p.journal_id
    ORDER BY p.date DESC, p.id DESC`).all());
});

app.post('/api/journals', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'name required' });
  const r = db.prepare(`INSERT INTO journals
    (name, start_balance, trailing_dd, daily_loss_limit, dd_stops_at_start, deposit_date,
     firm, phase, profit_target, consistency_pct, consistency_cushion_pct, min_profit_days, min_profit_day_amount, max_contracts,
     min_payout, payout_cap, max_payouts, default_risk, dd_stop_mode, dd_buffer, cost)
    VALUES (@name, @start_balance, @trailing_dd, @daily_loss_limit, @dd_stops_at_start, @deposit_date,
     @firm, @phase, @profit_target, @consistency_pct, @consistency_cushion_pct, @min_profit_days, @min_profit_day_amount, @max_contracts,
     @min_payout, @payout_cap, @max_payouts, @default_risk, @dd_stop_mode, @dd_buffer, @cost)`).run({
    name: String(b.name).trim(),
    start_balance: Number(b.start_balance ?? 50000),
    trailing_dd: Number(b.trailing_dd ?? 2500),
    daily_loss_limit: Number(b.daily_loss_limit ?? 0),
    dd_stops_at_start: b.dd_stops_at_start ? 1 : 0,
    deposit_date: b.deposit_date ?? null,
    firm: b.firm ?? null,
    phase: b.phase ?? 'eval',
    profit_target: Number(b.profit_target ?? 3000),
    consistency_pct: Number(b.consistency_pct ?? 0),
    consistency_cushion_pct: Number(b.consistency_cushion_pct ?? 0),
    min_profit_days: Number(b.min_profit_days ?? 0),
    min_profit_day_amount: Number(b.min_profit_day_amount ?? 0),
    max_contracts: Number(b.max_contracts ?? 0),
    min_payout: Number(b.min_payout ?? 0),
    payout_cap: Number(b.payout_cap ?? 0),
    max_payouts: Number(b.max_payouts ?? 0),
    default_risk: Number(b.default_risk ?? 0),
    dd_stop_mode: b.dd_stop_mode ?? 'never',
    dd_buffer: Number(b.dd_buffer ?? 100),
    cost: Number(b.cost ?? 0),
  });
  res.json(getJournal(r.lastInsertRowid));
});

app.patch('/api/journals/:id', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such journal' });
  const allowed = ['name', 'start_balance', 'trailing_dd', 'daily_loss_limit', 'dd_stops_at_start',
    'deposit_date', 'firm', 'phase', 'profit_target', 'consistency_pct', 'consistency_cushion_pct',
    'min_profit_days', 'min_profit_day_amount', 'max_contracts', 'min_payout', 'payout_cap', 'max_payouts', 'default_risk',
    'dd_stop_mode', 'dd_buffer', 'broker', 'platform', 'cost', 'broker_username', 'broker_password'];
  for (const k of allowed) {
    if (k in (req.body || {})) {
      db.prepare(`UPDATE journals SET ${k} = ? WHERE id = ?`).run(req.body[k], j.id);
    }
  }
  res.json(getJournal(j.id));
});

// The hidden "Film Library" journal is where clips go when their account is
// deleted, so they outlive the account. Created lazily; archived + is_library so
// it never shows in the switcher or the Archive list.
function libraryJournalId() {
  const row = db.prepare('SELECT id FROM journals WHERE is_library = 1 LIMIT 1').get();
  if (row) return row.id;
  return db.prepare('INSERT INTO journals (name, archived, is_library) VALUES (?, 1, 1)')
    .run('Film Library').lastInsertRowid;
}

app.delete('/api/journals/:id', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such journal' });
  if (j.is_library) return res.status(400).json({ error: 'cannot delete the film library' });
  // Preserve CLIPS: move this account's clip entries into the Film Library
  // (tagged with the original account name) so they survive. Everything else —
  // real trades, notes, payouts — is deleted with the account.
  const hasClips = db.prepare('SELECT 1 FROM trades WHERE journal_id = ? AND clip_only = 1 LIMIT 1').get(j.id);
  if (hasClips) {
    db.prepare('UPDATE trades SET journal_id = ?, account = ? WHERE journal_id = ? AND clip_only = 1')
      .run(libraryJournalId(), j.name, j.id);
  }
  // Remove media FILES for the REMAINING (non-clip) trades — the cascade drops
  // their DB rows but not the files. Moved clips keep their files, untouched.
  const media = db.prepare(
    'SELECT m.video, m.screenshots FROM trade_meta m JOIN trades t ON t.id = m.trade_id WHERE t.journal_id = ?'
  ).all(j.id);
  for (const row of media) {
    if (row.video) deleteVideo(req.user.uid, row.video);
    let shots = []; try { shots = JSON.parse(row.screenshots || '[]'); } catch {}
    for (const name of shots) deleteShot(req.user.uid, name);
  }
  db.prepare('DELETE FROM journals WHERE id = ?').run(j.id); // cascades remaining trades/meta
  res.json({ ok: true });
});

// Archive an account (passed or blown). Data is KEPT (records/taxes) — the
// account is flagged archived and drops out of the active switcher. On a PASS
// we also spin up a matching funded account (same size + drawdown rules); the
// user only supplies the name.
app.post('/api/journals/:id/archive', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such journal' });
  const outcome = req.body?.outcome === 'passed' ? 'passed' : 'blown';
  db.prepare("UPDATE journals SET archived = 1, archived_at = datetime('now'), outcome = ? WHERE id = ?")
    .run(outcome, j.id);

  let funded = null;
  if (outcome === 'passed') {
    const name = String(req.body?.fundedName || '').trim() || `${j.name} — Funded`;
    // Funded PAYOUT rules (winning days, consistency, payout limits) come from the
    // matching funded preset (client sends them) — the eval's own rules omit them.
    // Fall back to the eval's value when a field isn't supplied (custom accounts).
    const fr = req.body?.fundedRules || {};
    const r = db.prepare(`INSERT INTO journals
      (name, start_balance, trailing_dd, daily_loss_limit, dd_stops_at_start, deposit_date,
       firm, phase, profit_target, consistency_pct, consistency_cushion_pct, min_profit_days, min_profit_day_amount,
       max_contracts, min_payout, payout_cap, max_payouts, default_risk, dd_stop_mode, dd_buffer, parent_journal_id)
      VALUES (@name, @start_balance, @trailing_dd, @daily_loss_limit, @dd_stops_at_start, @deposit_date,
       @firm, 'funded', 0, @consistency_pct, @consistency_cushion_pct, @min_profit_days, @min_profit_day_amount,
       @max_contracts, @min_payout, @payout_cap, @max_payouts, @default_risk, 'buffer', @dd_buffer, @parent)`).run({
      name,
      start_balance: j.start_balance,          // same size (50k eval → 50k funded)
      // Funded (Apex PA): NO profit target, and the trailing DD LOCKS at
      // start + buffer ($100) — dd_stop_mode 'buffer' (both hardcoded above).
      trailing_dd: fr.trailing_dd ?? j.trailing_dd,
      daily_loss_limit: fr.daily_loss_limit ?? j.daily_loss_limit,
      dd_stops_at_start: j.dd_stops_at_start,
      deposit_date: new Date().toISOString().slice(0, 10),
      firm: j.firm,
      consistency_pct: fr.consistency_pct ?? j.consistency_pct,
      consistency_cushion_pct: fr.consistency_cushion_pct ?? j.consistency_cushion_pct,
      min_profit_days: fr.min_profit_days ?? j.min_profit_days,
      min_profit_day_amount: fr.min_profit_day_amount ?? j.min_profit_day_amount,
      max_contracts: fr.max_contracts ?? j.max_contracts,
      min_payout: fr.min_payout ?? j.min_payout,
      payout_cap: fr.payout_cap ?? j.payout_cap,
      max_payouts: fr.max_payouts ?? j.max_payouts,
      default_risk: j.default_risk,
      dd_buffer: fr.dd_buffer ?? j.dd_buffer,  // Apex buffer = $100 → DD locks at start + $100
      parent: j.id,
    });
    funded = getJournal(r.lastInsertRowid);
  }
  res.json({ archived: getJournal(j.id), funded });
});

// --- data (journal-scoped) ---------------------------------------------------
app.post('/api/import', webMultipart('files'), (req, res) => {
  const id = Number(req.query?.journal || req.body?.journal);
  if (!id || !getJournal(id)) return res.status(400).json({ error: 'missing or unknown journal' });
  const results = [];
  for (const f of req.files || []) {
    try {
      results.push({ file: f.originalname, ...importCsv(f.buffer.toString('utf8'), f.originalname, id) });
    } catch (e) {
      results.push({ file: f.originalname, error: e.message });
    }
  }
  db.prepare('UPDATE journals SET last_import_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  res.json({ results });
});

// Reset the account's IMPORTED trades (wrong CSV) so a clean file can be
// re-imported. Clears the raw fills too — they're the source of truth and would
// otherwise re-pair into trades on the next import. Manual clips (source
// 'manual') are KEPT. Payouts/notes are untouched.
app.post('/api/journals/:id/reset-trades', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such journal' });
  const id = j.id;
  // Remove media files for the imported trades being deleted (clips stay).
  const media = db.prepare(
    "SELECT m.video, m.screenshots FROM trade_meta m JOIN trades t ON t.id = m.trade_id WHERE t.journal_id = ? AND t.source != 'manual'"
  ).all(id);
  for (const row of media) {
    if (row.video) deleteVideo(req.user.uid, row.video);
    let shots = []; try { shots = JSON.parse(row.screenshots || '[]'); } catch {}
    for (const name of shots) deleteShot(req.user.uid, name);
  }
  db.transaction(() => {
    db.prepare('DELETE FROM fills WHERE journal_id = ?').run(id);
    db.prepare("DELETE FROM trade_meta WHERE trade_id IN (SELECT id FROM trades WHERE journal_id = ? AND source != 'manual')").run(id);
    db.prepare("DELETE FROM trades WHERE journal_id = ? AND source != 'manual'").run(id);
    db.prepare('UPDATE journals SET last_import_at = NULL WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

app.get('/api/summary', (req, res) => { const id = journalId(req, res); if (id) res.json(summary(id)); });
app.get('/api/dashboard', (req, res) => { const id = journalId(req, res); if (id) res.json(dashboard(id)); });
app.get('/api/equity', (req, res) => { const id = journalId(req, res); if (id) res.json(equity(id)); });
app.get('/api/patterns', (req, res) => { const id = journalId(req, res); if (id) res.json(patterns(id)); });
app.get('/api/insights', (req, res) => { const id = journalId(req, res); if (id) res.json(insights(id)); });
app.get('/api/review', (req, res) => { const id = journalId(req, res); if (id) res.json(review(id)); });
// Cross-account clip library: every Film Room video attached to a trade on an
// ARCHIVED account. NOT journal-scoped — it aggregates across accounts so clips
// stay watchable after their account leaves the active switcher (un-archiving
// the account removes them from here and returns them to its own strip).
app.get('/api/film-library', (req, res) => {
  // Full trade+meta shape (same as GET /trades) so a Library clip can be opened
  // in the edit card and corrected, even though its account is archived.
  res.json(db.prepare(`
    SELECT t.*, m.setup, m.mistakes, m.notes, m.rating, m.screenshots, m.stop, m.target,
           m.direction_call, m.entry_timing, m.market_move, m.intuition, m.mfe_points, m.video,
           -- orphaned clips (account deleted) live on the Film Library journal but
           -- remember their original account name in t.account.
           CASE WHEN j.is_library = 1 THEN t.account ELSE j.name END AS account,
           j.archived_at
    FROM trades t
    JOIN trade_meta m ON m.trade_id = t.id
    JOIN journals j ON j.id = t.journal_id
    WHERE m.video IS NOT NULL AND j.archived = 1
    ORDER BY j.archived_at DESC, t.exit_time DESC
  `).all());
});
app.get('/api/journal', (req, res) => { const id = journalId(req, res); if (id) res.json(dailyJournal(id)); });

// Daily log note (free-text per day).
app.put('/api/day-log/:date', (req, res) => {
  const id = journalId(req, res);
  if (!id) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: 'bad date' });
  db.prepare(`INSERT INTO day_logs (journal_id, date, note) VALUES (?, ?, ?)
    ON CONFLICT(journal_id, date) DO UPDATE SET note = excluded.note`).run(id, req.params.date, req.body?.note ?? '');
  res.json({ ok: true });
});
app.get('/api/risk', (req, res) => { const id = journalId(req, res); if (id) res.json(risk(id)); });
app.get('/api/challenge', (req, res) => { const id = journalId(req, res); if (id) res.json(challenge(id)); });

app.get('/api/trades', (req, res) => {
  const id = journalId(req, res);
  if (!id) return;
  // clip_only placeholders are hidden by default (Closed Trades, Analytics) so
  // they never count as trades; the Film Room passes ?includeClips=1 so it can
  // still open them and play their clip.
  const clipFilter = req.query.includeClips ? '' : 'AND t.clip_only IS NOT 1';
  const rows = db.prepare(`
    SELECT t.*, m.setup, m.mistakes, m.notes, m.rating, m.screenshots, m.stop, m.target,
           m.direction_call, m.entry_timing, m.market_move, m.intuition, m.mfe_points, m.video
    FROM trades t LEFT JOIN trade_meta m ON m.trade_id = t.id
    WHERE t.journal_id = ? ${clipFilter}
    ORDER BY t.exit_time DESC
  `).all(id);
  res.json(rows);
});

// Create a MANUAL review entry (source='manual') to hold a Film Room clip for a
// past trade not in any CSV. These are ALWAYS clip_only=1 — a real, counted trade
// only ever comes from a CSV import. `journal_id` in the body picks the account
// the clip belongs to (chosen in the modal); it survives fills re-imports.
app.post('/api/trades', (req, res) => {
  const b = req.body || {};
  let id;
  if (b.journal_id != null) {
    id = Number(b.journal_id);
    if (!getJournal(id)) return res.status(400).json({ error: 'no such account' });
  } else {
    id = journalId(req, res);
    if (!id) return;
  }
  const product = String(b.product || '').trim().toUpperCase();
  if (!productMap()[product]) return res.status(400).json({ error: 'product must be NQ/ES/MNQ/MES' });
  const direction = b.direction === 'short' ? 'short' : 'long';
  const qty = Math.max(1, Math.round(Number(b.qty) || 1));
  const pnl = b.pnl == null || b.pnl === '' ? 0 : Number(b.pnl);
  if (Number.isNaN(pnl)) return res.status(400).json({ error: 'pnl must be a number' });
  const points = b.points == null || b.points === '' ? null : Number(b.points);
  // When only a date/time is given, use it for both entry and exit (a single
  // moment is fine for after-the-fact review; duration is unknown).
  const exit_time = b.exit_time || b.entry_time || new Date().toISOString().slice(0, 19);
  const entry_time = b.entry_time || exit_time;
  const contract = String(b.contract || product).trim().toUpperCase();
  // ALWAYS clip_only=1: a manual review entry is never a counted trade (only CSV
  // imports are). Excluded from every stat/calendar/count — see stats.allTrades.
  const r = db.prepare(`INSERT INTO trades
    (journal_id, account, product, contract, direction, qty, entry_time, exit_time,
     entry_price, exit_price, points, pnl, fees, duration_s, source, clip_only)
    VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'manual', 1)`).run(
    id, product, contract, direction, qty, entry_time, exit_time,
    b.entry_price == null || b.entry_price === '' ? null : Number(b.entry_price),
    b.exit_price == null || b.exit_price === '' ? null : Number(b.exit_price),
    points, pnl);
  res.json(db.prepare('SELECT * FROM trades WHERE id = ?').get(r.lastInsertRowid));
});

// Delete a MANUAL trade (and its meta/screenshots). Imported trades aren't
// deletable here — they'd just return on the next import anyway.
app.delete('/api/trades/:id', (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT source FROM trades WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'no such trade' });
  if (t.source !== 'manual') return res.status(400).json({ error: 'only manual trades can be deleted' });
  const meta = db.prepare('SELECT screenshots, video FROM trade_meta WHERE trade_id = ?').get(id);
  const shots = (() => { try { return JSON.parse(meta?.screenshots || '[]'); } catch { return []; } })();
  for (const name of shots) deleteShot(req.user.uid, name);
  if (meta?.video) deleteVideo(req.user.uid, meta.video);
  db.prepare('DELETE FROM trades WHERE id = ?').run(id); // cascades trade_meta
  res.json({ ok: true });
});

app.patch('/api/trades/:id/meta', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) return res.status(404).json({ error: 'no such trade' });
  const {
    setup = null, mistakes = null, notes = null, rating = null, stop = null, target = null,
    direction_call = null, entry_timing = null, market_move = null, intuition = null, mfe_points = null,
  } = req.body || {};
  const blank = (v) => (v == null || v === '' ? null : v);
  const num = (v) => (v == null || v === '' ? null : Number(v));
  // screenshots are managed by their own endpoints — never clobbered here.
  db.prepare(`
    INSERT INTO trade_meta (trade_id, setup, mistakes, notes, rating, stop, target,
      direction_call, entry_timing, market_move, intuition, mfe_points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_id) DO UPDATE SET setup=excluded.setup, mistakes=excluded.mistakes,
      notes=excluded.notes, rating=excluded.rating, stop=excluded.stop, target=excluded.target,
      direction_call=excluded.direction_call, entry_timing=excluded.entry_timing,
      market_move=excluded.market_move, intuition=excluded.intuition, mfe_points=excluded.mfe_points
  `).run(id, setup, mistakes == null ? null : JSON.stringify(mistakes), notes, rating,
    num(stop), num(target), blank(direction_call), blank(entry_timing), blank(market_move),
    blank(intuition), num(mfe_points));
  res.json({ ok: true });
});

// Correct core fields on a MANUAL trade (logged the wrong instrument/direction in
// "Add trade to review" — e.g. NQ instead of MNQ). Manual only: imported trades
// are rebuilt from fills, so edits here would be overwritten. contract mirrors
// product (manual trades have no distinct symbol).
app.patch('/api/trades/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT source FROM trades WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'no such trade' });
  if (row.source !== 'manual') return res.status(400).json({ error: 'only manual trades can be edited' });
  const patch = {};
  if (req.body?.product != null) {
    const product = String(req.body.product).trim().toUpperCase();
    if (!productMap()[product]) return res.status(400).json({ error: 'product must be NQ/ES/MNQ/MES' });
    patch.product = product;
    patch.contract = product;
  }
  if (req.body?.direction != null) patch.direction = req.body.direction === 'short' ? 'short' : 'long';
  if (req.body?.qty != null) patch.qty = Math.max(1, Math.round(Number(req.body.qty) || 1));
  if (!Object.keys(patch).length) return res.json({ ok: true });
  const cols = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE trades SET ${cols} WHERE id = ?`).run(...Object.values(patch), id);
  res.json({ ok: true });
});

// --- trade screenshots (max 2 per trade; files served on demand) ------------
app.get('/api/screenshots/:name', (req, res) => {
  streamShot(req, res, req.user.uid, req.params.name).catch(() => res.status(404).end());
});

const getShots = (tradeId) => {
  const row = db.prepare('SELECT screenshots FROM trade_meta WHERE trade_id = ?').get(tradeId);
  try { return JSON.parse(row?.screenshots || '[]'); } catch { return []; }
};
const setShots = (tradeId, shots) => {
  db.prepare(`
    INSERT INTO trade_meta (trade_id, screenshots) VALUES (?, ?)
    ON CONFLICT(trade_id) DO UPDATE SET screenshots = excluded.screenshots
  `).run(tradeId, JSON.stringify(shots));
};

app.post('/api/trades/:id/screenshots', webMultipart('files'), async (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) return res.status(404).json({ error: 'no such trade' });
  const shots = getShots(id);
  let rejected = 0;
  for (const f of req.files || []) {
    if (shots.length >= 2) { rejected++; continue; }
    if (!/^image\//.test(f.mimetype)) { rejected++; continue; }
    const ext = (f.originalname.match(/\.(png|jpe?g|gif|webp)$/i)?.[1] || 'png').toLowerCase();
    const name = `t${id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await saveShot(req.user.uid, name, f.buffer);
    shots.push(name);
  }
  setShots(id, shots);
  res.json({ screenshots: shots, rejected });
});

app.delete('/api/trades/:id/screenshots/:name', async (req, res) => {
  const id = Number(req.params.id);
  const shots = getShots(id);
  const name = req.params.name;
  if (!shots.includes(name)) return res.status(404).json({ error: 'no such screenshot' });
  setShots(id, shots.filter((s) => s !== name));
  await deleteShot(req.user.uid, name);
  res.json({ screenshots: shots.filter((s) => s !== name) });
});

// --- Film Room video (one clip per trade; served on demand) ------------------
app.get('/api/videos/:name', (req, res) => {
  streamVideo(req, res, req.user.uid, req.params.name).catch(() => res.status(404).end());
});

const getVideo = (tradeId) =>
  db.prepare('SELECT video FROM trade_meta WHERE trade_id = ?').get(tradeId)?.video || null;
const setVideo = (tradeId, name) => {
  db.prepare(`
    INSERT INTO trade_meta (trade_id, video) VALUES (?, ?)
    ON CONFLICT(trade_id) DO UPDATE SET video = excluded.video
  `).run(tradeId, name);
};

// Ask for an upload target for a new clip. Web → short-lived signed Storage
// URL; dev → the local PUT endpoint. The client PUTs the bytes there (straight
// to the bucket on the web — Cloud Functions can't take a 500 MB body), then
// records the filename with POST /api/trades/:id/video.
app.post('/api/uploads/video-start', async (req, res) => {
  const id = Number(req.body?.tradeId);
  if (!id || !db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'no such trade' });
  }
  const ext = (String(req.body?.ext || '').match(/^[a-z0-9]{1,5}$/i)?.[0] || 'mp4').toLowerCase();
  const filename = `t${id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  res.json({ filename, url: await uploadUrl(req.user.uid, filename) });
});

// Dev-mode target for uploadUrl(): the browser PUTs the clip body here and we
// stream it to disk. On the web this endpoint is never called (the PUT goes to
// Storage directly).
app.put('/api/uploads/local/:name', (req, res) => {
  if (isWeb) return res.status(404).end();
  const name = req.params.name;
  if (!/^t\d+-[0-9a-f]{12}\.[a-z0-9]{1,5}$/i.test(name)) return res.status(400).json({ error: 'bad filename' });
  const target = path.join(process.cwd(), 'videos', name);
  const ws = fs.createWriteStream(target);
  ws.on('error', () => res.status(500).end());
  ws.on('finish', () => res.json({ ok: true }));
  req.on('aborted', () => ws.destroy());
  req.pipe(ws);
});

// Record (or replace) the clip. Client uploaded the file first; we only store
// the filename and drop any previous clip.
app.post('/api/trades/:id/video', async (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) return res.status(404).json({ error: 'no such trade' });
  const name = String(req.body?.video || '');
  if (!/^t\d+-[0-9a-f]{12}\.[a-z0-9]{1,5}$/i.test(name)) return res.status(400).json({ error: 'bad filename' });
  const prev = getVideo(id);
  if (prev && prev !== name) deleteVideo(req.user.uid, prev);
  setVideo(id, name);
  res.json({ video: name });
});

app.delete('/api/trades/:id/video', async (req, res) => {
  const id = Number(req.params.id);
  const prev = getVideo(id);
  if (prev) await deleteVideo(req.user.uid, prev);
  setVideo(id, null);
  res.json({ video: null });
});

// --- Playbook: global library of annotated chart screenshots ------------------
// Files share the screenshots/ dir (served at /api/screenshots) with a 'lib-'
// prefix so they never collide with per-trade shots.
app.get('/api/library', (_req, res) => {
  res.json(db.prepare('SELECT * FROM library_items ORDER BY created_at DESC, id DESC').all());
});

app.post('/api/library', webMultipart('file'), async (req, res) => {
  if (!req.file || !/^image\//.test(req.file.mimetype)) return res.status(400).json({ error: 'image file required' });
  const ext = (req.file.originalname.match(/\.(png|jpe?g|gif|webp)$/i)?.[1] || 'png').toLowerCase();
  const filename = `lib-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await saveShot(req.user.uid, filename, req.file.buffer);
  const { category = null, title = null, note = null } = req.body || {};
  const blank = (v) => (v == null || v === '' ? null : String(v));
  const r = db.prepare('INSERT INTO library_items (category, title, note, filename) VALUES (?, ?, ?, ?)')
    .run(blank(category), blank(title), blank(note), filename);
  res.json(db.prepare('SELECT * FROM library_items WHERE id = ?').get(r.lastInsertRowid));
});

// Update an item's metadata (category/title/note) without re-uploading.
app.patch('/api/library/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM library_items WHERE id = ?').get(id)) return res.status(404).json({ error: 'no such item' });
  const { category = null, title = null, note = null } = req.body || {};
  const blank = (v) => (v == null || v === '' ? null : String(v));
  db.prepare('UPDATE library_items SET category = ?, title = ?, note = ? WHERE id = ?')
    .run(blank(category), blank(title), blank(note), id);
  res.json(db.prepare('SELECT * FROM library_items WHERE id = ?').get(id));
});

app.delete('/api/library/:id', async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT filename FROM library_items WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'no such item' });
  await deleteShot(req.user.uid, row.filename);
  db.prepare('DELETE FROM library_items WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- manual daily P&L entries (days without per-trade data) -------------------
app.get('/api/days', (req, res) => {
  const id = journalId(req, res);
  if (id) res.json(db.prepare('SELECT date, pnl, trades, note FROM manual_days WHERE journal_id = ? ORDER BY date').all(id));
});

app.put('/api/days/:date', (req, res) => {
  const id = journalId(req, res);
  if (!id) return;
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
  const { pnl, trades = null, note = null } = req.body || {};
  if (typeof pnl !== 'number' || Number.isNaN(pnl)) return res.status(400).json({ error: 'pnl (number) required' });
  db.prepare(`
    INSERT INTO manual_days (journal_id, date, pnl, trades, note) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(journal_id, date) DO UPDATE SET pnl = excluded.pnl, trades = excluded.trades, note = excluded.note
  `).run(id, date, pnl, trades, note);
  res.json({ ok: true });
});

app.delete('/api/days/:date', (req, res) => {
  const id = journalId(req, res);
  if (!id) return;
  db.prepare('DELETE FROM manual_days WHERE journal_id = ? AND date = ?').run(id, req.params.date);
  res.json({ ok: true });
});

// --- payouts (funded phase; each resets the qualifying-day cycle) -------------
app.get('/api/payouts', (req, res) => {
  const id = journalId(req, res);
  if (id) res.json(db.prepare('SELECT * FROM payouts WHERE journal_id = ? ORDER BY date, id').all(id));
});

app.post('/api/payouts', (req, res) => {
  const id = journalId(req, res);
  if (!id) return;
  const { date, amount, note = null } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'date YYYY-MM-DD required' });
  if (typeof amount !== 'number' || Number.isNaN(amount)) return res.status(400).json({ error: 'amount (number) required' });
  db.prepare('INSERT INTO payouts (journal_id, date, amount, note) VALUES (?, ?, ?, ?)').run(id, date, amount, note);
  res.json({ ok: true });
});

app.delete('/api/payouts/:pid', (req, res) => {
  db.prepare('DELETE FROM payouts WHERE id = ?').run(Number(req.params.pid));
  res.json({ ok: true });
});

// --- products (global: NQ/ES + micros) ----------------------------------------
app.get('/api/products', (_req, res) => res.json(productMap()));
app.patch('/api/products', (req, res) => {
  for (const [sym, p] of Object.entries(req.body || {})) {
    db.prepare('UPDATE products SET point_value = ?, fee_rt = ? WHERE symbol = ?')
      .run(Number(p.point_value), Number(p.fee_rt), sym);
  }
  res.json(productMap());
});

// Danger zone: wipe one journal's imported data (keeps the journal + rules).
app.post('/api/reset', (req, res) => {
  const id = Number(req.query.journal);
  if (!id || !getJournal(id)) return res.status(400).json({ error: 'missing or unknown journal' });
  db.prepare('DELETE FROM trade_meta WHERE trade_id IN (SELECT id FROM trades WHERE journal_id = ?)').run(id);
  db.prepare('DELETE FROM trades WHERE journal_id = ?').run(id);
  db.prepare('DELETE FROM fills WHERE journal_id = ?').run(id);
  db.prepare('DELETE FROM manual_days WHERE journal_id = ?').run(id);
  res.json({ ok: true });
});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Local-only media serving for resolved URLs (/media/screenshots/…, /media/videos/…).
// On the web, media stays in Cloud Storage behind signed URLs instead.
if (!isWeb) {
  app.use('/media/screenshots', express.static(shotsDir, { immutable: true, maxAge: '365d' }));
  app.use('/media/videos', express.static(videosDir, { immutable: true, maxAge: '365d' }));
}
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

const PORT = 5175;
// Bind to 0.0.0.0 so it's reachable from your phone on the same Wi-Fi. In DEV you
// open Vite's Network URL (:5173, which proxies /api here); in production-serve
// (npm run build && npm start) you open this server directly at :5175. In WEB
// mode (Firebase Functions) the app is exported instead of listening.
function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

export default app;

if (!isWeb) {
  app.listen(PORT, '0.0.0.0', () => {
    const ip = lanIp();
    console.log(`journal api on http://localhost:${PORT}`);
    if (ip) console.log(`  ↳ LAN (phone, production-serve): http://${ip}:${PORT}`);
  });
}
