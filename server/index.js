// Local-only Express server: CSV import + stats API + (in production) the
// built frontend. Dev runs alongside Vite (which proxies /api here).
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSettings, setSetting, productMap } from './db.js';
import { importCsv } from './importer.js';
import { summary, equity, patterns, risk, dashboard } from './stats.js';

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/import', upload.array('files'), (req, res) => {
  const results = [];
  for (const f of req.files || []) {
    try {
      results.push({ file: f.originalname, ...importCsv(f.buffer.toString('utf8'), f.originalname) });
    } catch (e) {
      results.push({ file: f.originalname, error: e.message });
    }
  }
  res.json({ results });
});

app.get('/api/summary', (_req, res) => res.json(summary()));
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/equity', (_req, res) => res.json(equity()));
app.get('/api/patterns', (_req, res) => res.json(patterns()));
app.get('/api/risk', (_req, res) => res.json(risk()));

app.get('/api/trades', (_req, res) => {
  const rows = db.prepare(`
    SELECT t.*, m.setup, m.mistakes, m.notes, m.rating
    FROM trades t LEFT JOIN trade_meta m ON m.trade_id = t.id
    ORDER BY t.exit_time DESC
  `).all();
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

app.get('/api/settings', (_req, res) => res.json({ settings: getSettings(), products: productMap() }));
app.patch('/api/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body?.settings || {})) setSetting(k, v);
  for (const [sym, p] of Object.entries(req.body?.products || {})) {
    db.prepare('UPDATE products SET point_value = ?, fee_rt = ? WHERE symbol = ?')
      .run(Number(p.point_value), Number(p.fee_rt), sym);
  }
  res.json({ ok: true });
});

// Danger zone: wipe all imported data (keeps settings/products).
app.post('/api/reset', (_req, res) => {
  db.exec('DELETE FROM trade_meta; DELETE FROM trades; DELETE FROM fills;');
  res.json({ ok: true });
});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

const PORT = 5175;
app.listen(PORT, '127.0.0.1', () => console.log(`journal api on http://127.0.0.1:${PORT}`));
