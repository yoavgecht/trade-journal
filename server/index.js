// Local-only Express server: journals CRUD + CSV import + stats API + (in
// production) the built frontend. Dev runs alongside Vite (proxies /api here).
// Every data endpoint is scoped to a journal (?journal=ID) — one journal per
// prop account.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getJournal, productMap } from './db.js';
import { importCsv } from './importer.js';
import { summary, equity, patterns, risk, dashboard, challenge, insights, overviewAll, dailyJournal, review, archiveList } from './stats.js';

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const SESSION_DAYS = 14;

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const i = part.indexOf('=');
    if (i === -1) return [decodeURIComponent(part.trim()), ''];
    return [decodeURIComponent(part.slice(0, i).trim()), decodeURIComponent(part.slice(i + 1).trim())];
  }));
}

function sessionCookie(token) {
  return [
    `tj_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ].join('; ');
}

const clearSessionCookie = 'tj_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 210000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function validPassword(password, user) {
  const { hash } = hashPassword(password, user.password_salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.password_hash, 'hex'));
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  res.setHeader('Set-Cookie', sessionCookie(token));
}

function currentUser(req) {
  const token = parseCookies(req).tj_session;
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, s.token
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return row || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'authentication required' });
  req.user = user;
  next();
}

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? { id: user.id, email: user.email } : null, needsSetup: userCount() === 0 });
});

app.post('/api/auth/register', (req, res) => {
  if (userCount() > 0) return res.status(403).json({ error: 'account already exists' });
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'valid email required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  const { salt, hash } = hashPassword(password);
  const r = db.prepare('INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)').run(email, hash, salt);
  createSession(res, r.lastInsertRowid);
  res.json({ user: { id: r.lastInsertRowid, email } });
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !validPassword(password, user)) return res.status(401).json({ error: 'invalid email or password' });
  createSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).tj_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', clearSessionCookie);
  res.json({ ok: true });
});

app.use('/api', requireAuth);

// Film Room clips can be a few hundred MB, so we STREAM straight to disk (never
// buffer the whole file in memory) and allow up to 500 MB. Duration is enforced
// client-side (the browser can read it; the server can't without ffprobe). The
// filename is derived from the trade id so it's stable and easy to clean up.
const videosDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'videos');
fs.mkdirSync(videosDir, { recursive: true });
const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, videosDir),
    filename: (req, file, cb) => {
      const ext = (file.originalname.match(/\.(mp4|mov|webm|m4v|ogg|ogv)$/i)?.[1] || 'mp4').toLowerCase();
      cb(null, `t${Number(req.params.id)}-${crypto.randomBytes(6).toString('hex')}.${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => cb(null, /^video\//.test(file.mimetype)), // skip non-video, no throw
  limits: { fileSize: 500 * 1024 * 1024 },
});
// Run the upload middleware but turn multer errors (e.g. too big) into clean JSON.
const runVideoUpload = (req, res, next) =>
  uploadVideo.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'file too large (max 500 MB)' : 'upload failed' });
    }
    next();
  });

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
    if (row.video) fs.rm(path.join(videosDir, row.video), () => {});
    let shots = []; try { shots = JSON.parse(row.screenshots || '[]'); } catch {}
    for (const name of shots) fs.rm(path.join(shotsDir, name), () => {});
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
app.post('/api/import', upload.array('files'), (req, res) => {
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
    if (row.video) fs.rm(path.join(videosDir, row.video), () => {});
    let shots = []; try { shots = JSON.parse(row.screenshots || '[]'); } catch {}
    for (const name of shots) fs.rm(path.join(shotsDir, name), () => {});
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
  for (const name of shots) fs.rm(path.join(shotsDir, name), () => {});
  if (meta?.video) fs.rm(path.join(videosDir, meta.video), () => {});
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

// --- trade screenshots (max 2 per trade; files live in screenshots/) ---------
const shotsDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'screenshots');
fs.mkdirSync(shotsDir, { recursive: true });
app.use('/api/screenshots', express.static(shotsDir));

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

app.post('/api/trades/:id/screenshots', upload.array('files'), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) return res.status(404).json({ error: 'no such trade' });
  const shots = getShots(id);
  let rejected = 0;
  for (const f of req.files || []) {
    if (shots.length >= 2) { rejected++; continue; }
    if (!/^image\//.test(f.mimetype)) { rejected++; continue; }
    const ext = (f.originalname.match(/\.(png|jpe?g|gif|webp)$/i)?.[1] || 'png').toLowerCase();
    const name = `t${id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(shotsDir, name), f.buffer);
    shots.push(name);
  }
  setShots(id, shots);
  res.json({ screenshots: shots, rejected });
});

app.delete('/api/trades/:id/screenshots/:name', (req, res) => {
  const id = Number(req.params.id);
  const shots = getShots(id);
  const name = req.params.name;
  if (!shots.includes(name)) return res.status(404).json({ error: 'no such screenshot' });
  setShots(id, shots.filter((s) => s !== name));
  fs.rm(path.join(shotsDir, name), () => {});
  res.json({ screenshots: shots.filter((s) => s !== name) });
});

// --- Film Room video (one clip per trade; files live in videos/) --------------
app.use('/api/videos', express.static(videosDir));

const getVideo = (tradeId) =>
  db.prepare('SELECT video FROM trade_meta WHERE trade_id = ?').get(tradeId)?.video || null;
const setVideo = (tradeId, name) => {
  db.prepare(`
    INSERT INTO trade_meta (trade_id, video) VALUES (?, ?)
    ON CONFLICT(trade_id) DO UPDATE SET video = excluded.video
  `).run(tradeId, name);
};

// One clip per trade — replaces any existing. Video files only (streamed to disk).
app.post('/api/trades/:id/video', runVideoUpload, (req, res) => {
  const id = Number(req.params.id);
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'video file required' });
  // File is already on disk; if the trade is bogus, drop it and bail.
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) {
    fs.rm(path.join(videosDir, f.filename), () => {});
    return res.status(404).json({ error: 'no such trade' });
  }
  const prev = getVideo(id);
  if (prev && prev !== f.filename) fs.rm(path.join(videosDir, prev), () => {});
  setVideo(id, f.filename);
  res.json({ video: f.filename });
});

app.delete('/api/trades/:id/video', (req, res) => {
  const id = Number(req.params.id);
  const prev = getVideo(id);
  if (prev) fs.rm(path.join(videosDir, prev), () => {});
  setVideo(id, null);
  res.json({ video: null });
});

// --- Playbook: global library of annotated chart screenshots ------------------
// Files share the screenshots/ dir (served at /api/screenshots) with a 'lib-'
// prefix so they never collide with per-trade shots.
app.get('/api/library', (_req, res) => {
  res.json(db.prepare('SELECT * FROM library_items ORDER BY created_at DESC, id DESC').all());
});

app.post('/api/library', upload.single('file'), (req, res) => {
  if (!req.file || !/^image\//.test(req.file.mimetype)) return res.status(400).json({ error: 'image file required' });
  const ext = (req.file.originalname.match(/\.(png|jpe?g|gif|webp)$/i)?.[1] || 'png').toLowerCase();
  const filename = `lib-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(shotsDir, filename), req.file.buffer);
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

app.delete('/api/library/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT filename FROM library_items WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'no such item' });
  fs.rm(path.join(shotsDir, row.filename), () => {});
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
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

const PORT = 5175;
// Bind to 0.0.0.0 so it's reachable from your phone on the same Wi-Fi. In DEV you
// open Vite's Network URL (:5173, which proxies /api here); in production-serve
// (npm run build && npm start) you open this server directly at :5175.
function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}
app.listen(PORT, '0.0.0.0', () => {
  const ip = lanIp();
  console.log(`journal api on http://localhost:${PORT}`);
  if (ip) console.log(`  ↳ LAN (phone, production-serve): http://${ip}:${PORT}`);
});
