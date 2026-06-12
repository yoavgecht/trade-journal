// SQLite storage — single local file (journal.db in the project root).
//
// A JOURNAL = one prop account (e.g. "Apex 50k Eval #3") with its own rules
// (start balance, trailing drawdown, personal daily loss limit). Fills and
// trades belong to a journal; the dashboard always shows one journal at a
// time. Futures-only: NQ & ES (plus their micros MNQ/MES) — the importer
// skips anything else.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const db = new Database(path.join(root, 'journal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Pre-journals schema (no journal_id) only ever held sample data — rebuild.
const fillCols = db.prepare("SELECT name FROM pragma_table_info('fills')").all().map((c) => c.name);
if (fillCols.length && !fillCols.includes('journal_id')) {
  db.exec('DROP TABLE IF EXISTS trade_meta; DROP TABLE IF EXISTS trades; DROP TABLE IF EXISTS fills;');
}
db.exec('DROP TABLE IF EXISTS settings;'); // replaced by per-journal columns

db.exec(`
CREATE TABLE IF NOT EXISTS journals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_balance REAL NOT NULL DEFAULT 50000,
  trailing_dd REAL NOT NULL DEFAULT 2500,
  dd_stops_at_start INTEGER NOT NULL DEFAULT 1,
  daily_loss_limit REAL NOT NULL DEFAULT 1000,
  deposit_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account TEXT,
  contract TEXT,            -- e.g. NQZ4
  product TEXT,             -- NQ | ES | MNQ | MES
  side TEXT,                -- buy | sell
  qty INTEGER NOT NULL,
  price REAL NOT NULL,
  fill_time TEXT NOT NULL,  -- ISO local
  source_file TEXT,
  hash TEXT UNIQUE          -- dedup re-imports of the same rows
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
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
  pnl REAL,                 -- $ net of fees
  fees REAL DEFAULT 0,
  duration_s INTEGER,
  source TEXT DEFAULT 'fills' -- fills (paired here) | performance (pre-paired)
);

CREATE TABLE IF NOT EXISTS trade_meta (
  trade_id INTEGER PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,
  setup TEXT,
  mistakes TEXT,            -- JSON array of tags
  notes TEXT,
  rating INTEGER
);

CREATE TABLE IF NOT EXISTS products (
  symbol TEXT PRIMARY KEY,
  point_value REAL NOT NULL,
  fee_rt REAL NOT NULL DEFAULT 0  -- round-trip fees+commissions per contract
);
`);

// NQ & ES only (minis + micros). fee_rt defaults are typical Tradovate/Apex
// all-in round-trips — editable in Settings.
db.exec("DELETE FROM products WHERE symbol NOT IN ('NQ','ES','MNQ','MES')");
const seedProducts = db.prepare(
  'INSERT OR IGNORE INTO products (symbol, point_value, fee_rt) VALUES (?, ?, ?)',
);
for (const [sym, pv, fee] of [
  ['NQ', 20, 4.28], ['MNQ', 2, 1.04],
  ['ES', 50, 4.28], ['MES', 5, 1.04],
]) seedProducts.run(sym, pv, fee);

export function productMap() {
  const m = {};
  for (const p of db.prepare('SELECT * FROM products').all()) m[p.symbol] = p;
  return m;
}

export function getJournal(id) {
  return db.prepare('SELECT * FROM journals WHERE id = ?').get(id);
}
