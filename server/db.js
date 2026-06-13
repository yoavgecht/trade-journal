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
  -- Challenge / payout rules (Apex / Lucid / MFFU evals + funded):
  firm TEXT,                                  -- label only (Lucid / Apex / MFFU…)
  phase TEXT DEFAULT 'eval',                  -- eval | funded
  profit_target REAL NOT NULL DEFAULT 3000,   -- pass target ($); 0 = none (live)
  consistency_pct REAL NOT NULL DEFAULT 0,    -- best-day cap as % of total; 0 = none
  consistency_cushion_pct REAL NOT NULL DEFAULT 0, -- extra pp of slack (Lucid = 2 → effective 52%)
  min_profit_days INTEGER NOT NULL DEFAULT 0, -- qualifying days needed (payout)
  min_profit_day_amount REAL NOT NULL DEFAULT 0, -- $ that makes a day "qualifying"
  max_contracts INTEGER NOT NULL DEFAULT 0,   -- position-size cap (mini); 0 = none
  min_payout REAL NOT NULL DEFAULT 0,         -- minimum payout request ($)
  payout_cap REAL NOT NULL DEFAULT 0,         -- max $ per payout (account-size cap); 0 = none
  max_payouts INTEGER NOT NULL DEFAULT 0,     -- payouts before moved to live; 0 = n/a
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,       -- YYYY-MM-DD (approval date; resets the qualifying-day cycle)
  amount REAL NOT NULL,
  note TEXT
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
  rating INTEGER,           -- 1-5 execution quality, independent of P&L
  screenshots TEXT          -- JSON array of filenames in screenshots/ (max 2)
);

CREATE TABLE IF NOT EXISTS manual_days (
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,       -- YYYY-MM-DD
  pnl REAL NOT NULL,
  trades INTEGER,           -- count only (no per-trade detail)
  note TEXT,
  PRIMARY KEY (journal_id, date)
);

CREATE TABLE IF NOT EXISTS products (
  symbol TEXT PRIMARY KEY,
  point_value REAL NOT NULL,
  fee_rt REAL NOT NULL DEFAULT 0  -- round-trip fees+commissions per contract
);
`);

// Pre-screenshots installs: add the column in place (meta is worth keeping).
const metaCols = db.prepare("SELECT name FROM pragma_table_info('trade_meta')").all().map((c) => c.name);
if (metaCols.length && !metaCols.includes('screenshots')) {
  db.exec('ALTER TABLE trade_meta ADD COLUMN screenshots TEXT');
}

// Pre-challenge journals: add the rule columns in place (journals are precious).
const jCols = db.prepare("SELECT name FROM pragma_table_info('journals')").all().map((c) => c.name);
for (const [col, ddl] of [
  ['firm', 'firm TEXT'],
  ['phase', "phase TEXT DEFAULT 'eval'"],
  ['profit_target', 'profit_target REAL NOT NULL DEFAULT 3000'],
  ['consistency_pct', 'consistency_pct REAL NOT NULL DEFAULT 0'],
  ['consistency_cushion_pct', 'consistency_cushion_pct REAL NOT NULL DEFAULT 0'],
  ['min_profit_days', 'min_profit_days INTEGER NOT NULL DEFAULT 0'],
  ['min_profit_day_amount', 'min_profit_day_amount REAL NOT NULL DEFAULT 0'],
  ['max_contracts', 'max_contracts INTEGER NOT NULL DEFAULT 0'],
  ['min_payout', 'min_payout REAL NOT NULL DEFAULT 0'],
  ['payout_cap', 'payout_cap REAL NOT NULL DEFAULT 0'],
  ['max_payouts', 'max_payouts INTEGER NOT NULL DEFAULT 0'],
]) {
  if (jCols.length && !jCols.includes(col)) db.exec(`ALTER TABLE journals ADD COLUMN ${ddl}`);
}

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
