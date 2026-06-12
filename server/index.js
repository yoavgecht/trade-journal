// Local-only Express server: journals CRUD + CSV import + stats API + (in
// production) the built frontend. Dev runs alongside Vite (proxies /api here).
// Every data endpoint is scoped to a journal (?journal=ID) — one journal per
// prop account.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getJournal, productMap } from './db.js';
import { importCsv } from './importer.js';
import { summary, equity, patterns, risk, dashboard } from './stats.js';

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
  const { name, start_balance = 50000, trailing_dd = 2500, daily_loss_limit = 1000,
    dd_stops_at_start = 1, deposit_date = null } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const r = db.prepare(`INSERT INTO journals (name, start_balance, trailing_dd, daily_loss_limit, dd_stops_at_start, deposit_date)
    VALUES (?, ?, ?, ?, ?, ?)`).run(String(name).trim(), Number(start_balance), Number(trailing_dd),
    Number(daily_loss_limit), dd_stops_at_start ? 1 : 0, deposit_date);
  res.json(getJournal(r.lastInsertRowid));
});

app.patch('/api/journals/:id', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'no such journal' });
  const allowed = ['name', 'start_balance', 'trailing_dd', 'daily_loss_limit', 'dd_stops_at_start', 'deposit_date'];
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
app.get('/api/risk', (req, res) => { const id = journalId(req, res); if (id) res.json(risk(id)); });

app.get('/api/trades', (req, res) => {
  const id = journalId(req, res);
  if (!id) return;
  const rows = db.prepare(`
    SELECT t.*, m.setup, m.mistakes, m.notes, m.rating
    FROM trades t LEFT JOIN trade_meta m ON m.trade_id = t.id
    WHERE t.journal_id = ?
    ORDER BY t.exit_time DESC
  `).all(id);
  res.json(rows);
});

app.patch('/api/trades/:id/meta', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM trades WHERE id = ?').get(id)) return res.status(404).json({ error: 'no such trade' });
  const { setup = null, mistakes = null, notes = null, rating = null } = req.body || {};
  db.prepare(`
    INSERT INTO trade_meta (trade_id, setup, mistakes, notes, rating) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(trade_id) DO UPDATE SET setup=excluded.setup, mistakes=excluded.mistakes,
      notes=excluded.notes, rating=excluded.rating
  `).run(id, setup, mistakes == null ? null : JSON.stringify(mistakes), notes, rating);
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
  res.json({ ok: true });
});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

const PORT = 5175;
app.listen(PORT, '127.0.0.1', () => console.log(`journal api on http://127.0.0.1:${PORT}`));
