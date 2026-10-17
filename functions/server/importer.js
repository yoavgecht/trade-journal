// Tradovate CSV importer. Two export shapes are accepted:
//
//  1. FILLS export (Reports → Fills): one row per fill. We normalize headers,
//     dedup by content hash, and FIFO-pair fills into round-trip trades per
//     account+contract (a trade = position opens from flat and returns to flat).
//
//  2. PERFORMANCE export (Reports → Performance): one row per already-paired
//     trade (has buy/sell prices + P&L). Imported directly as trades.
//
// Header names vary between Tradovate versions, so matching is done on
// lowercased, alphanumeric-only names against candidate lists.
import crypto from 'node:crypto';
import Papa from 'papaparse';
import { db, productMap, feeFor } from './db.js';

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function pick(row, candidates) {
  for (const key of Object.keys(row)) {
    if (candidates.includes(norm(key))) return row[key];
  }
  return undefined;
}

const F = {
  time: ['filltime', 'timestamp', 'time', 'date', 'datetime'],
  side: ['bs', 'side', 'buysell', 'action'],
  qty: ['filledqty', 'qty', 'quantity', 'filledquantity', 'orderquantity'],
  price: ['avgprice', 'price', 'fillprice', 'avgfillprice'],
  contract: ['contract', 'symbol', 'instrument'],
  product: ['product'],
  account: ['account', 'accountname'],
};

// Performance-export columns (pre-paired trades).
const P = {
  symbol: ['symbol', 'contract', 'instrument'],
  qty: ['qty', 'quantity'],
  buyPrice: ['buyprice', 'boughtprice'],
  sellPrice: ['sellprice', 'soldprice'],
  pnl: ['pnl', 'profitloss', 'realizedpnl', 'netpnl'],
  boughtTime: ['boughttimestamp', 'boughttime', 'buytime'],
  soldTime: ['soldtimestamp', 'soldtime', 'selltime'],
  account: ['account', 'accountname'],
  duration: ['duration'],
};

// "NQZ4" / "NQH25" / "MNQM4" → product root ("NQ"/"MNQ"). Falls back to the
// alpha prefix when the month-code pattern doesn't match.
export function productFromContract(contract) {
  const c = String(contract || '').trim().toUpperCase();
  const m = c.match(/^([A-Z]+?)[FGHJKMNQUVXZ]\d{1,2}$/);
  if (m) return m[1];
  return c.replace(/[^A-Z].*$/, '');
}

function parseTime(v) {
  if (v == null || v === '') return null;
  // Tradovate exports local time like "04/23/2026 09:31:12" or ISO strings.
  const s = String(v).trim();
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (us) {
    const [, mm, dd, yyyy, H, M, S] = us;
    return `${yyyy}-${mm}-${dd}T${H}:${M}:${S || '00'}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  return null;
}

const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[$,()]/g, (c) => (c === '(' ? '-' : '')));
  return Number.isNaN(n) ? null : n;
};

export function importCsv(text, filename, journalId) {
  const parsed = Papa.parse(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows.length) return { kind: 'empty', fills: 0, trades: 0, skipped: 0 };

  const headers = Object.keys(rows[0]).map(norm);
  const isPerformance = headers.some((h) => P.pnl.includes(h)) &&
    (headers.some((h) => P.buyPrice.includes(h)) || headers.some((h) => P.soldTime.includes(h)));

  return isPerformance ? importPerformance(rows, filename, journalId) : importFills(rows, filename, journalId);
}

function importFills(rows, filename, journalId) {
  const products = productMap();
  const insert = db.prepare(`INSERT OR IGNORE INTO fills
    (journal_id, account, contract, product, side, qty, price, fill_time, source_file, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let added = 0, skipped = 0, otherMarkets = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const time = parseTime(pick(row, F.time));
      const sideRaw = String(pick(row, F.side) || '').toLowerCase();
      const side = sideRaw.startsWith('b') ? 'buy' : sideRaw.startsWith('s') ? 'sell' : null;
      const qty = Math.abs(Math.round(num(pick(row, F.qty)) ?? 0));
      const price = num(pick(row, F.price));
      const contract = String(pick(row, F.contract) || '').trim().toUpperCase();
      if (!time || !side || !qty || price == null || !contract) { skipped++; continue; }
      const product = String(pick(row, F.product) || '').trim().toUpperCase() || productFromContract(contract);
      if (!products[product]) { otherMarkets++; continue; } // NQ/ES (+micros) only
      const account = String(pick(row, F.account) || 'default').trim();
      const hash = crypto.createHash('sha1')
        .update([journalId, account, contract, side, qty, price, time].join('|')).digest('hex');
      const r = insert.run(journalId, account, contract, product, side, qty, price, time, filename, hash);
      if (r.changes > 0) added++; else skipped++;
    }
  });
  tx();
  const trades = rebuildTradesFromFills(journalId);
  return { kind: 'fills', fills: added, trades, skipped, otherMarkets };
}

// FIFO pairing. Trades sourced from fills are fully rebuilt on every import —
// fills are the source of truth, so pairing stays correct even when fills
// arrive across multiple files out of order. Pre-paired (performance) trades
// are left untouched. trade_meta survives via a stable signature match.
export function rebuildTradesFromFills(journalId) {
  const products = productMap();
  const fills = db.prepare('SELECT * FROM fills WHERE journal_id = ? ORDER BY fill_time, id').all(journalId);

  // Preserve meta: signature = account|contract|entry_time|exit_time
  const oldTrades = db.prepare("SELECT * FROM trades WHERE source = 'fills' AND journal_id = ?").all(journalId);
  const metaBySig = {};
  for (const t of oldTrades) {
    const meta = db.prepare('SELECT * FROM trade_meta WHERE trade_id = ?').get(t.id);
    if (meta) metaBySig[`${t.account}|${t.contract}|${t.entry_time}|${t.exit_time}`] = meta;
  }
  db.prepare("DELETE FROM trade_meta WHERE trade_id IN (SELECT id FROM trades WHERE source = 'fills' AND journal_id = ?)").run(journalId);
  db.prepare("DELETE FROM trades WHERE source = 'fills' AND journal_id = ?").run(journalId);

  const insert = db.prepare(`INSERT INTO trades
    (journal_id, account, product, contract, direction, qty, entry_time, exit_time,
     entry_price, exit_price, points, pnl, fees, duration_s, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fills')`);
  const insertMeta = db.prepare(`INSERT INTO trade_meta (trade_id, setup, mistakes, notes, rating, screenshots)
    VALUES (?, ?, ?, ?, ?, ?)`);

  let count = 0;
  const groups = {};
  for (const f of fills) (groups[`${f.account}|${f.contract}`] ??= []).push(f);

  const tx = db.transaction(() => {
    for (const key of Object.keys(groups)) {
      let pos = 0;                 // signed position
      let open = [];               // open lots: {qty signed, price, time}
      let closedPairs = [];        // {qty, entryPrice, exitPrice, dir}
      let entryTime = null, maxAbs = 0, volume = 0;

      const flush = (lastFill) => {
        if (!closedPairs.length) return;
        const f0 = groups[key][0];
        const product = products[f0.product] || { point_value: 1, fee_rt: 0 };
        const dir = closedPairs[0].dir;
        const totQty = closedPairs.reduce((s, p) => s + p.qty, 0);
        const entryAvg = closedPairs.reduce((s, p) => s + p.entryPrice * p.qty, 0) / totQty;
        const exitAvg = closedPairs.reduce((s, p) => s + p.exitPrice * p.qty, 0) / totQty;
        const points = dir === 'long' ? exitAvg - entryAvg : entryAvg - exitAvg;
        const fees = totQty * feeFor(journalId, f0.product);
        const pnl = points * product.point_value * totQty - fees;
        const durS = Math.max(0, (new Date(lastFill.fill_time) - new Date(entryTime)) / 1000);
        const r = insert.run(
          journalId, f0.account, f0.product, f0.contract, dir, maxAbs, entryTime, lastFill.fill_time,
          round(entryAvg), round(exitAvg), round(points), round(pnl), round(fees), Math.round(durS),
        );
        const sig = `${f0.account}|${f0.contract}|${entryTime}|${lastFill.fill_time}`;
        const meta = metaBySig[sig];
        if (meta) insertMeta.run(r.lastInsertRowid, meta.setup, meta.mistakes, meta.notes, meta.rating, meta.screenshots);
        count++;
        closedPairs = []; entryTime = null; maxAbs = 0;
      };

      for (const f of groups[key]) {
        const signed = f.side === 'buy' ? f.qty : -f.qty;
        if (pos === 0) entryTime = f.fill_time;

        let remaining = signed;
        // Close against opposite-direction open lots first (FIFO).
        while (remaining !== 0 && open.length && Math.sign(open[0].qty) !== Math.sign(remaining)) {
          const lot = open[0];
          const closeQty = Math.min(Math.abs(remaining), Math.abs(lot.qty));
          const dir = lot.qty > 0 ? 'long' : 'short';
          closedPairs.push({ qty: closeQty, entryPrice: lot.price, exitPrice: f.price, dir });
          lot.qty += Math.sign(remaining) * closeQty;
          remaining -= Math.sign(remaining) * closeQty;
          if (lot.qty === 0) open.shift();
        }
        if (remaining !== 0) open.push({ qty: remaining, price: f.price, time: f.fill_time });

        pos += signed;
        maxAbs = Math.max(maxAbs, Math.abs(pos));
        volume += f.qty;
        if (pos === 0) flush(f); // back to flat → round trip complete
      }
      // Open position at end of data: leave unpaired (shows up after next import).
    }
  });
  tx();
  return count;
}

function importPerformance(rows, filename, journalId) {
  const products = productMap();
  const insert = db.prepare(`INSERT INTO trades
    (journal_id, account, product, contract, direction, qty, entry_time, exit_time,
     entry_price, exit_price, points, pnl, fees, duration_s, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'performance')`);
  // A trade is identified by its CSV signature — times + qty + prices. The fee
  // setting is deliberately NOT part of the key: performance P&L is stored
  // gross and fees are subtracted at import, so re-importing the same CSV after
  // a fee change must RECALCULATE the stored trade, not insert a duplicate.
  // (Without this, the old pnl-based dedup missed on every fee change and each
  // trade got imported twice → doubled balances.)
  const find = db.prepare(`SELECT id FROM trades WHERE source='performance' AND journal_id=?
    AND account IS ? AND contract=? AND qty=? AND entry_price IS ? AND exit_price IS ?
    AND entry_time IS ? AND exit_time IS ?`);
  const update = db.prepare(`UPDATE trades SET direction=?, points=?, pnl=?, fees=?, duration_s=? WHERE id=?`);
  let added = 0, updated = 0, skipped = 0, otherMarkets = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const contract = String(pick(row, P.symbol) || '').trim().toUpperCase();
      const qty = Math.abs(Math.round(num(pick(row, P.qty)) ?? 0));
      const buyPrice = num(pick(row, P.buyPrice));
      const sellPrice = num(pick(row, P.sellPrice));
      const pnlRaw = num(pick(row, P.pnl));
      const bought = parseTime(pick(row, P.boughtTime));
      const sold = parseTime(pick(row, P.soldTime));
      if (!contract || !qty || pnlRaw == null || (!bought && !sold)) { skipped++; continue; }

      const direction = (bought && sold && bought <= sold) || (bought && !sold) ? 'long' : 'short';
      const entryTime = direction === 'long' ? bought : sold;
      const exitTime = direction === 'long' ? sold : bought;
      const entryPrice = direction === 'long' ? buyPrice : sellPrice;
      const exitPrice = direction === 'long' ? sellPrice : buyPrice;
      const product = productFromContract(contract);
      if (!products[product]) { otherMarkets++; continue; } // NQ/ES (+micros) only
      const pv = products[product]?.point_value || 1;
      const points = entryPrice != null && exitPrice != null
        ? (direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice)
        : pnlRaw / (pv * qty);
      const fees = qty * feeFor(journalId, product);
      const durS = entryTime && exitTime ? Math.max(0, (new Date(exitTime) - new Date(entryTime)) / 1000) : null;
      const account = String(pick(row, P.account) || 'default').trim();

      const sig = find.get(journalId, account, contract, qty, entryPrice, exitPrice, entryTime, exitTime);
      if (sig) {
        update.run(direction, round(points), round(pnlRaw - fees), round(fees),
          durS == null ? null : Math.round(durS), sig.id);
        updated++;
      } else {
        insert.run(journalId, account, product, contract, direction, qty, entryTime, exitTime,
          entryPrice, exitPrice, round(points), round(pnlRaw - fees), round(fees),
          durS == null ? null : Math.round(durS));
        added++;
      }
    }
  });
  tx();
  return { kind: 'performance', fills: 0, trades: added, updated, skipped, otherMarkets };
}

const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
