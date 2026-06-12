// SQLite storage — single local file (journal.db next to this folder's root).
// Fills are the raw imported rows (deduped by content hash); trades are the
// FIFO-paired round trips the dashboard reads. Settings hold prop-firm rule
// numbers so the Risk view can simulate trailing drawdown.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const db = new Database(path.join(root, 'journal.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY,
  account TEXT,
  contract TEXT,            -- e.g. NQZ4
  product TEXT,             -- e.g. NQ
  side TEXT,                -- buy | sell
  qty INTEGER NOT NULL,
  price REAL NOT NULL,
  fill_time TEXT NOT NULL,  -- ISO local
  source_file TEXT,
  hash TEXT UNIQUE          -- dedup re-imports of the same rows
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY,
  account TEXT,
  product TEXT,
  contract TEXT,
  direction TEXT,           -- long | short
  qty INTEGER,              -- max position size during the round trip
  entry_time TEXT,
  exit_time TEXT,
  entry_price REAL,         -- avg
  exit_price REAL,          -- avg
  points REAL,              -- per-contract points captured
  pnl REAL,                 -- gross $ (point value applied), minus fees
  fees REAL DEFAULT 0,
  duration_s INTEGER,
  source TEXT DEFAULT 'fills' -- fills (paired here) | performance (pre-paired)
);

CREATE TABLE IF NOT EXISTS trade_meta (
  trade_id INTEGER PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,
  setup TEXT,
  mistakes TEXT,            -- JSON array of tags
  notes TEXT,
  rating INTEGER            -- 1-5 execution quality, independent of P&L
);

CREATE TABLE IF NOT EXISTS products (
  symbol TEXT PRIMARY KEY,
  point_value REAL NOT NULL,
  fee_rt REAL NOT NULL DEFAULT 0  -- round-trip fees+commissions per contract
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// CME equity index futures the user trades (minis + micros). fee_rt defaults
// are typical Tradovate/Apex all-in round-trips — editable in Settings.
const seedProducts = db.prepare(
  'INSERT OR IGNORE INTO products (symbol, point_value, fee_rt) VALUES (?, ?, ?)',
);
for (const [sym, pv, fee] of [
  ['NQ', 20, 4.28], ['MNQ', 2, 1.04],
  ['ES', 50, 4.28], ['MES', 5, 1.04],
  ['RTY', 50, 4.28], ['M2K', 5, 1.04],
  ['YM', 5, 4.28], ['MYM', 0.5, 1.04],
]) seedProducts.run(sym, pv, fee);

const seedSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of [
  ['start_balance', '50000'],   // Apex 50k eval default
  ['trailing_dd', '2500'],      // its trailing drawdown
  ['dd_stops_at_start', '1'],   // Apex-style: threshold stops trailing at start balance
  ['daily_loss_limit', '1000'], // personal rule, not the firm's
]) seedSettings.run(k, v);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function getSettings() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
export function productMap() {
  const m = {};
  for (const p of db.prepare('SELECT * FROM products').all()) m[p.symbol] = p;
  return m;
}
