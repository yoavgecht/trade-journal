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
  dd_stops_at_start INTEGER NOT NULL DEFAULT 1, -- legacy; superseded by dd_stop_mode
  -- How the EOD trailing threshold stops climbing (Apex rules):
  --   'never'  → trails the peak EOD balance forever (Tradovate evals)
  --   'buffer' → locks at start + dd_buffer  (PA / funded; Apex = $100)
  --   'target' → locks at start + profit_target (Rithmic/WealthCharts evals)
  dd_stop_mode TEXT NOT NULL DEFAULT 'never',
  dd_buffer REAL NOT NULL DEFAULT 100,
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
  source TEXT DEFAULT 'fills', -- fills (paired here) | performance (pre-paired)
  clip_only INTEGER NOT NULL DEFAULT 0 -- 1 = Film Room clip placeholder, NOT a real trade (excluded from every stat/calendar/count)
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

CREATE TABLE IF NOT EXISTS day_logs (
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,       -- YYYY-MM-DD
  note TEXT,
  PRIMARY KEY (journal_id, date)
);

CREATE TABLE IF NOT EXISTS products (
  symbol TEXT PRIMARY KEY,
  point_value REAL NOT NULL,
  fee_rt REAL NOT NULL DEFAULT 0  -- round-trip fees+commissions per contract
);

-- Playbook: a GLOBAL library of annotated chart screenshots (setups, traps,
-- mistakes, A+ examples…), independent of any journal/trade. Pure study
-- reference. Image files live in screenshots/ with a 'lib-' prefix.
CREATE TABLE IF NOT EXISTS library_items (
  id INTEGER PRIMARY KEY,
  category TEXT,            -- Setup | Trap | Mistake | A+ Trade | Lesson (free text)
  title TEXT,
  note TEXT,
  filename TEXT NOT NULL,   -- file in screenshots/
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Pre-screenshots installs: add the column in place (meta is worth keeping).
const metaCols = db.prepare("SELECT name FROM pragma_table_info('trade_meta')").all().map((c) => c.name);
if (metaCols.length && !metaCols.includes('screenshots')) {
  db.exec('ALTER TABLE trade_meta ADD COLUMN screenshots TEXT');
}

// Per-trade stop/target → R-multiples (risk-normalized performance).
const metaCols2 = db.prepare("SELECT name FROM pragma_table_info('trade_meta')").all().map((c) => c.name);
for (const [col, ddl] of [['stop', 'stop REAL'], ['target', 'target REAL']]) {
  if (metaCols2.length && !metaCols2.includes(col)) db.exec(`ALTER TABLE trade_meta ADD COLUMN ${ddl}`);
}

// "Film Room" behavioral review — the trader's own read on each trade, graded
// off the entry/outcome screenshots (not derivable from fills):
//   direction_call → was the DIRECTIONAL bias right, regardless of P&L? right|wrong
//   entry_timing   → early | good | late | chased  (the "right idea, wrong moment" axis)
//   market_move    → trend | pullback | breakout | reversal | range | news (which move it was)
//   intuition      → plan (followed the plan) | gut (acted on a gut feel)
//   mfe_points     → max favorable excursion after entry, per-contract points (how far it
//                    went your way) → vs trade.points captured = points left on the table
const metaCols3 = db.prepare("SELECT name FROM pragma_table_info('trade_meta')").all().map((c) => c.name);
for (const [col, ddl] of [
  ['direction_call', 'direction_call TEXT'],
  ['entry_timing', 'entry_timing TEXT'],
  ['market_move', 'market_move TEXT'],
  ['intuition', 'intuition TEXT'],
  ['mfe_points', 'mfe_points REAL'],
  ['video', 'video TEXT'], // Film Room clip filename in videos/ (≤2 min), or null
]) {
  if (metaCols3.length && !metaCols3.includes(col)) db.exec(`ALTER TABLE trade_meta ADD COLUMN ${ddl}`);
}

// Trades: clip_only marks a Film Room clip placeholder (a "trade" created only
// to hold a video/review, e.g. from a screen recording). It must NOT count as a
// real trade anywhere — calendar, P&L, challenge/consistency, win rate, counts —
// but still shows in the Film Room so the clip is watchable.
const tradeCols = db.prepare("SELECT name FROM pragma_table_info('trades')").all().map((c) => c.name);
for (const [col, ddl] of [
  ['clip_only', 'clip_only INTEGER NOT NULL DEFAULT 0'],
]) {
  if (tradeCols.length && !tradeCols.includes(col)) db.exec(`ALTER TABLE trades ADD COLUMN ${ddl}`);
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
  ['default_risk', 'default_risk REAL NOT NULL DEFAULT 0'], // $ risked/trade when no per-trade stop set
  ['dd_stop_mode', "dd_stop_mode TEXT NOT NULL DEFAULT 'never'"],
  ['dd_buffer', 'dd_buffer REAL NOT NULL DEFAULT 100'],
  ['last_import_at', 'last_import_at TEXT'], // set on each CSV import → Dashboard defaults to the most recent
  // Archive: a passed or blown account is kept FOREVER (records/taxes) but moved
  // out of the active switcher into the Archive view.
  ['archived', 'archived INTEGER NOT NULL DEFAULT 0'],
  ['archived_at', 'archived_at TEXT'],
  ['is_library', 'is_library INTEGER NOT NULL DEFAULT 0'], // hidden holding for clips whose account was deleted
  ['outcome', 'outcome TEXT'],                        // 'passed' | 'blown'
  ['parent_journal_id', 'parent_journal_id INTEGER'], // funded acct ← the eval it was passed from
  ['broker', 'broker TEXT'],                          // e.g. Tradovate — display only (Account Data strip)
  ['platform', 'platform TEXT'],                      // e.g. TradingView — display only
  ['cost', 'cost REAL NOT NULL DEFAULT 0'],           // what you paid for this account (eval price + activation fee) — Expenses tab
  ['broker_username', 'broker_username TEXT'],        // broker login (stored locally, plaintext) — credentials bar
  ['broker_password', 'broker_password TEXT'],
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
