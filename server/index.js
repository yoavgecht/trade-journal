// Local-only Express server: journals CRUD + CSV import + stats API + (in
// production) the built frontend. Dev runs alongside Vite (proxies /api here).
// Every data endpoint is scoped to a journal (?journal=ID) — one journal per
// prop account.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getJournal, productMap } from './db.js';
import { importCsv } from './importer.js';
import { summary, equity, patterns, risk, dashboard, challenge, insights } from './stats.js';

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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
  res.json(db.prepare('SELECT * FROM journals ORDER BY id').all());
});

app.post('/api/journals', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'name required' });
  const r = db.prepare(`INSERT INTO journals
    (name, start_balance, trailing_dd, daily_loss_limit, dd_stops_at_start, deposit_date,
     firm, phase, profit_target, consistency_pct, consistency_cushion_pct, min_profit_days, min_profit_day_amount, max_contracts,
     min_payout, payout_cap, max_payouts, default_risk)
    VALUES (@name, @start_balance, @trailing_dd, @daily_loss_limit, @dd_stops_at_start, @deposit_date,
     @firm, @phase, @profit_target, @consistency_pct, @consistency_cushion_pct, @min_profit_days, @min_profit_day_amount, @max_contracts,
     @min_payout, @payout_cap, @max_payouts, @default_risk)`).run({
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
  });
  res.json(getJournal(r.lastInsertRowid));
});

app.patch('/api/journals/:id', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such journal' });
  const allowed = ['name', 'start_balance', 'trailing_dd', 'daily_loss_limit', 'dd_stops_at_start',
    'deposit_date', 'firm', 'phase', 'profit_target', 'consistency_pct', 'consistency_cushion_pct',
    'min_profit_days', 'min_profit_day_amount', 'max_contracts', 'min_payout', 'payout_cap', 'max_payouts', 'default_risk'];
  for (const k of allowed) {
    if (k in (req.body || {})) {
      db.prepare(`UPDATE journals SET ${k} = ? WHERE id = ?`).run(req.body[k], j.id);
    }
  }
  res.json(getJournal(j.id));
});

app.delete('/api/journals/:id', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such journal' });
  db.prepare('DELETE FROM journals WHERE id = ?').run(j.id); // cascades fills/trades/meta
  res.json({ ok: true });
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
  res.json({ results });
});

app.get('/api/summary', (req, res) => { const id = journalId(req, res); if (id) res.json(summary(id)); });
app.get('/api/dashboard', (req, res) => { const id = journalId(req, res); if (id) res.json(dashboard(id)); });
app.get('/api/equity', (req, res) => { const id = journalId(req, res); if (id) res.json(equity(id)); });
app.get('/api/patterns', (req, res) => { const id = journalId(req, res); if (id) res.json(patterns(id)); });
app.get('/api/insights', (req, res) => { const id = journalId(req, res); if (id) res.json(insights(id)); });
app.get('/api/risk', (req, res) => { const id = journalId(req, res); if (id) res.json(risk(id)); });
app.get('/api/challenge', (req, res) => { const id = journalId(req, res); if (id) res.json(challenge(id)); });

app.get('/api/trades', (req, res) => {
  const id = journalId(req, res);
  if (!id) return;
  const rows = db.prepare(`
    SELECT t.*, m.setup, m.mistakes, m.notes, m.rating, m.screenshots, m.stop, m.target
    FROM trades t LEFT JOIN trade_meta m ON m.trade_id = t.id
    WHERE t.journal_id = ?
    ORDER BY t.exit_time DESC
  `).all(id);
  res.json(rows);
});

app.patch('/api/trades/:id/meta', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) return res.status(404).json({ error: 'no such trade' });
  const { setup = null, mistakes = null, notes = null, rating = null, stop = null, target = null } = req.body || {};
  // screenshots are managed by their own endpoints — never clobbered here.
  db.prepare(`
    INSERT INTO trade_meta (trade_id, setup, mistakes, notes, rating, stop, target) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_id) DO UPDATE SET setup=excluded.setup, mistakes=excluded.mistakes,
      notes=excluded.notes, rating=excluded.rating, stop=excluded.stop, target=excluded.target
  `).run(id, setup, mistakes == null ? null : JSON.stringify(mistakes), notes, rating,
    stop == null || stop === '' ? null : Number(stop), target == null || target === '' ? null : Number(target));
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
app.listen(PORT, '127.0.0.1', () => console.log(`journal api on http://127.0.0.1:${PORT}`));
