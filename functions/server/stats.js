// Aggregations the dashboard reads. Everything derives from the trades table;
// "day" means the trade's EXIT date (when P&L was realized).
import { db, getJournal } from './db.js';

// Every aggregate reads through here, so filtering clip_only = 1 (Film Room clip
// placeholders) in ONE place keeps them out of P&L, calendar, challenge, win
// rate, counts — everything. `IS NOT 1` also covers legacy NULLs.
const allTrades = (journalId) =>
  db.prepare('SELECT * FROM trades WHERE exit_time IS NOT NULL AND journal_id = ? AND clip_only IS NOT 1 ORDER BY exit_time').all(journalId);

const day = (iso) => (iso || '').slice(0, 10);
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

// ── Break-even band ──────────────────────────────────────────────────────────
// A trade counts as a win/loss only if |pnl| exceeds BE_BAND; anything within
// ±BE_BAND is scratch/fees noise → break-even, excluded from the win-rate
// numerator AND denominator. This is the SINGLE definition of a win rate — every
// tab (Dashboard, Patterns, Daily, Review, Archive, Overview) reads it through
// winRatePct() so they all agree. Money figures (P&L, profit factor, gross) keep
// counting every trade; only the win RATE strips scratches.
export const BE_BAND = 10;
const isWin = (t) => t.pnl > BE_BAND;
const isLoss = (t) => t.pnl < -BE_BAND;
// Win rate (%) over a trade list with break-even trades removed. Returns null
// when there are no decisive (non-scratch) trades to rate.
const winRatePct = (list) => {
  const w = list.filter(isWin).length, l = list.filter(isLoss).length;
  return w + l ? r2((w / (w + l)) * 100) : null;
};

export function summary(journalId) {
  const trades = allTrades(journalId);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const total = trades.reduce((s, t) => s + t.pnl, 0);

  // Longest win/loss streaks
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curW++; curL = 0; } else if (t.pnl < 0) { curL++; curW = 0; }
    maxW = Math.max(maxW, curW); maxL = Math.max(maxL, curL);
  }

  const byProduct = {};
  for (const t of trades) {
    const p = (byProduct[t.product] ??= { trades: 0, pnl: 0, wins: 0 });
    p.trades++; p.pnl += t.pnl; if (t.pnl > 0) p.wins++;
  }

  return {
    trades: trades.length,
    contracts: trades.reduce((s, t) => s + (t.qty || 0), 0), // total size traded
    totalPnl: r2(total),
    winRate: winRatePct(trades) ?? 0, // break-even-adjusted (see BE_BAND)
    profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : null,
    expectancy: trades.length ? r2(total / trades.length) : 0,
    avgWin: wins.length ? r2(grossWin / wins.length) : 0,
    avgLoss: losses.length ? r2(-grossLoss / losses.length) : 0,
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    fees: r2(trades.reduce((s, t) => s + (t.fees || 0), 0)),
    byProduct: Object.fromEntries(Object.entries(byProduct).map(([k, v]) => [k, { ...v, pnl: r2(v.pnl) }])),
  };
}

export function equity(journalId) {
  const trades = allTrades(journalId);
  const daily = {};
  for (const t of trades) {
    const d = day(t.exit_time);
    (daily[d] ??= { date: d, pnl: 0, trades: 0 });
    daily[d].pnl += t.pnl; daily[d].trades++;
  }
  // Manual daily entries (days journaled without per-trade data — e.g. typed
  // in from a prop firm's dashboard) merge into the same series.
  for (const m of db.prepare('SELECT date, pnl, trades FROM manual_days WHERE journal_id = ?').all(journalId)) {
    (daily[m.date] ??= { date: m.date, pnl: 0, trades: 0 });
    daily[m.date].pnl += m.pnl;
    daily[m.date].trades += m.trades || 0;
    daily[m.date].manual = true;
  }
  const days = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0;
  for (const d of days) { cum += d.pnl; d.pnl = r2(d.pnl); d.cum = r2(cum); }
  return days;
}

export function patterns(journalId) {
  const trades = allTrades(journalId);

  // P&L / win-rate by hour of day and by weekday (exit time).
  const byHour = {}, byDow = {};
  for (const t of trades) {
    const d = new Date(t.exit_time);
    const h = d.getHours(), w = d.getDay();
    (byHour[h] ??= { hour: h, pnl: 0, trades: 0, wins: 0 });
    byHour[h].pnl += t.pnl; byHour[h].trades++; if (t.pnl > 0) byHour[h].wins++;
    (byDow[w] ??= { dow: w, pnl: 0, trades: 0, wins: 0 });
    byDow[w].pnl += t.pnl; byDow[w].trades++; if (t.pnl > 0) byDow[w].wins++;
  }

  // Revenge-trade check: trades entered within 5 minutes of a LOSING exit,
  // compared with everything else. Also: do sizes grow right after a loss?
  const REVENGE_MS = 5 * 60 * 1000;
  const sorted = [...trades].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  const revenge = [], normal = [];
  let sizeAfterLoss = [], sizeOther = [];
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const prev = sorted
      .slice(0, i)
      .filter((p) => p.exit_time <= t.entry_time)
      .sort((a, b) => b.exit_time.localeCompare(a.exit_time))[0];
    const afterLoss = prev && prev.pnl < 0;
    const quick = prev && new Date(t.entry_time) - new Date(prev.exit_time) <= REVENGE_MS;
    (afterLoss && quick ? revenge : normal).push(t);
    (afterLoss ? sizeAfterLoss : sizeOther).push(t.qty || 1);
  }
  const agg = (arr) => ({
    trades: arr.length,
    pnl: r2(arr.reduce((s, t) => s + t.pnl, 0)),
    winRate: winRatePct(arr), // break-even-adjusted (see BE_BAND)
    avgPnl: arr.length ? r2(arr.reduce((s, t) => s + t.pnl, 0) / arr.length) : null,
  });
  const avg = (a) => (a.length ? r2(a.reduce((s, x) => s + x, 0) / a.length) : null);

  // Overtrading: per-day trade counts on green vs red days.
  const daily = {};
  for (const t of trades) {
    const d = day(t.exit_time);
    (daily[d] ??= { pnl: 0, trades: 0 });
    daily[d].pnl += t.pnl; daily[d].trades++;
  }
  const days = Object.values(daily);
  const greenDays = days.filter((d) => d.pnl > 0), redDays = days.filter((d) => d.pnl < 0);

  // Personal daily-loss-limit discipline: on days that breached the limit,
  // how much MORE was lost by continuing to trade past the breach point?
  const limit = getJournal(journalId)?.daily_loss_limit || 0;
  let breachDays = 0, lossAfterBreach = 0;
  if (limit > 0) {
    const byDay = {};
    for (const t of trades) (byDay[day(t.exit_time)] ??= []).push(t);
    for (const d of Object.keys(byDay)) {
      let run = 0, breached = false;
      for (const t of byDay[d].sort((a, b) => a.exit_time.localeCompare(b.exit_time))) {
        if (breached) lossAfterBreach += t.pnl;
        run += t.pnl;
        if (!breached && run <= -limit) { breached = true; breachDays++; }
      }
    }
  }

  return {
    byHour: Object.values(byHour).map((h) => ({ ...h, pnl: r2(h.pnl) })).sort((a, b) => a.hour - b.hour),
    byDow: Object.values(byDow).map((d) => ({ ...d, pnl: r2(d.pnl) })).sort((a, b) => a.dow - b.dow),
    revenge: agg(revenge),
    nonRevenge: agg(normal),
    avgSizeAfterLoss: avg(sizeAfterLoss),
    avgSizeOther: avg(sizeOther),
    avgTradesGreenDay: greenDays.length ? r2(greenDays.reduce((s, d) => s + d.trades, 0) / greenDays.length) : null,
    avgTradesRedDay: redDays.length ? r2(redDays.reduce((s, d) => s + d.trades, 0) / redDays.length) : null,
    dailyLossLimit: limit,
    breachDays,
    lossAfterBreach: r2(lossAfterBreach),
    mistakeTags: mistakeBreakdown(journalId),
  };
}

// P&L attribution per mistake tag (from trade_meta.mistakes JSON arrays).
function mistakeBreakdown(journalId) {
  const rows = db.prepare(`
    SELECT m.mistakes, t.pnl FROM trade_meta m JOIN trades t ON t.id = m.trade_id
    WHERE t.journal_id = ? AND m.mistakes IS NOT NULL AND m.mistakes != '[]'
  `).all(journalId);
  const tags = {};
  for (const r of rows) {
    let arr = [];
    try { arr = JSON.parse(r.mistakes); } catch {}
    for (const tag of arr) {
      (tags[tag] ??= { tag, trades: 0, pnl: 0 });
      tags[tag].trades++; tags[tag].pnl += r.pnl;
    }
  }
  return Object.values(tags).map((t) => ({ ...t, pnl: r2(t.pnl) })).sort((a, b) => a.pnl - b.pnl);
}

// Apex EOD trailing drawdown simulation over the imported history.
//
// Rules (apextraderfunding.com): the threshold is the lowest balance allowed.
// It's recalculated at each EOD close, trails the HIGHEST EOD balance, and
// NEVER moves down. The instant balance touches it → liquidation (eval failed /
// PA closed). So the threshold is a HARD FLOOR: you can never lose past it, and
// once hit the account is dead. Where it stops climbing depends on account type:
//   never  → trails the peak EOD balance forever (Tradovate evals)
//   buffer → locks at start + dd_buffer  (PA / funded; Apex = $100)
//   target → locks at start + profit_target (Rithmic/WealthCharts evals)
export function risk(journalId) {
  const j = getJournal(journalId) || {};
  const start = j.start_balance || 0;
  const dd = j.trailing_dd || 0;
  const mode = j.dd_stop_mode || 'never';
  const buffer = j.dd_buffer ?? 100;
  const target = j.profit_target || 0;
  const lockLevel = mode === 'buffer' ? start + buffer
    : mode === 'target' ? start + target
    : Infinity; // 'never'

  const days = equity(journalId); // ordered daily closes (trading P&L only)
  // Payouts step the account balance DOWN on their date, but they are NOT trading
  // losses: the trailing floor (peak − dd) tracks TRADING equity, so a withdrawal
  // never triggers a breach — it just lowers the plotted balance line.
  const payoutRows = db.prepare('SELECT date, amount FROM payouts WHERE journal_id = ? ORDER BY date, id').all(journalId);
  const paidByDate = {};
  for (const p of payoutRows) paidByDate[p.date] = (paidByDate[p.date] || 0) + p.amount;
  const cumByDate = Object.fromEntries(days.map((d) => [d.date, d.cum]));
  const allDates = [...new Set([...days.map((d) => d.date), ...Object.keys(paidByDate)])].sort();

  let peakEOD = start;
  let threshold = start - dd;     // threshold in force for the NEXT session
  let minDistance = dd, breachedOn = null, tradingCum = 0, paid = 0, balance = start;
  const series = [];
  for (const date of allDates) {
    if (breachedOn) {
      // Account is already gone — real trading stopped here; freeze the floor.
      series.push({ date, balance: r2(threshold), threshold: r2(threshold), dead: true });
      continue;
    }
    if (date in cumByDate) tradingCum = cumByDate[date]; // trading cum through this day
    const tradingBalance = start + tradingCum;
    // Breach is enforced on TRADING equity vs the floor active this session (set
    // at the prior close). Touch/cross = dead, loss capped at the floor.
    if (tradingBalance <= threshold) {
      breachedOn = date;
      balance = threshold;
      minDistance = 0;
      series.push({ date, balance: r2(threshold), threshold: r2(threshold), dead: true });
      continue;
    }
    // Trailing floor recalced on TRADING equity (payouts don't lower the peak).
    peakEOD = Math.max(peakEOD, tradingBalance);
    threshold = Math.max(threshold, Math.min(peakEOD - dd, lockLevel));
    paid += paidByDate[date] || 0;
    balance = tradingBalance - paid; // plotted balance = trading equity minus withdrawals
    series.push({ date, balance: r2(balance), threshold: r2(threshold), payout: paidByDate[date] || 0 });
    minDistance = Math.min(minDistance, balance - threshold);
  }
  // Blank account (no trades yet, e.g. a freshly-passed funded account) — seed a
  // flat baseline so the growth chart still renders: balance flat at start,
  // threshold flat at start − dd.
  if (series.length === 0) {
    const d0 = j.deposit_date || new Date().toISOString().slice(0, 10);
    const dt = new Date(d0 + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 1); // UTC-safe +1 day
    const d1 = dt.toISOString().slice(0, 10);
    series.push({ date: d0, balance: r2(start), threshold: r2(threshold) });
    series.push({ date: d1, balance: r2(start), threshold: r2(threshold) });
  } else {
    // Anchor the line at the STARTING balance (deposit day, or the day before the
    // first close) so even a single trading day draws a visible curve, not a dot.
    const first = series[0].date;
    let anchor = j.deposit_date && j.deposit_date < first ? j.deposit_date : null;
    if (!anchor) { const dt = new Date(first + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - 1); anchor = dt.toISOString().slice(0, 10); }
    series.unshift({ date: anchor, balance: r2(start), threshold: r2(start - dd) });
  }
  const paidOut = payoutRows.reduce((s, p) => s + p.amount, 0);
  return {
    startBalance: start,
    trailingDd: dd,
    stopMode: mode,
    profitTarget: target || null,
    targetBalance: target ? r2(start + target) : null, // pass level = start + target
    lockLevel: lockLevel === Infinity ? null : r2(lockLevel),
    // Balance you must reach (EOD) for the trailing DD to LOCK: start + dd + buffer
    // (Apex: $50k + $2k + $100 = $52,100). Threshold then freezes at start + buffer.
    lockAt: mode === 'buffer' ? r2(start + dd + buffer) : null,
    currentBalance: r2(balance),
    currentThreshold: r2(threshold),
    distance: breachedOn ? 0 : r2(balance - threshold),
    minDistance: r2(Math.max(0, minDistance)),
    paidOut: r2(paidOut),
    breachedOn,
    series,
  };
}

// Daily Journal: one row per trading day with the day's stats, an intraday
// cumulative-P&L sparkline, and the free-text daily log note. Most-recent first.
export function dailyJournal(journalId) {
  const trades = db.prepare(`
    SELECT t.*, m.screenshots FROM trades t
    LEFT JOIN trade_meta m ON m.trade_id = t.id
    WHERE t.journal_id = ? AND t.exit_time IS NOT NULL AND t.clip_only IS NOT 1 ORDER BY t.exit_time
  `).all(journalId);
  const manual = db.prepare('SELECT date, pnl, trades, note FROM manual_days WHERE journal_id = ?').all(journalId);
  const logs = Object.fromEntries(db.prepare('SELECT date, note FROM day_logs WHERE journal_id = ?').all(journalId).map((r) => [r.date, r.note]));

  const byDay = {};
  for (const t of trades) (byDay[(t.exit_time || '').slice(0, 10)] ??= []).push(t);
  for (const m of manual) (byDay[m.date] ??= []); // ensure manual-only days appear

  const out = Object.keys(byDay).sort((a, b) => a.localeCompare(b)).map((date) => {
    const list = byDay[date].sort((a, b) => (a.exit_time || '').localeCompare(b.exit_time || ''));
    // Money split (gross/profit factor) counts every trade; the W/L COUNTS and
    // win rate below use the break-even band so they agree with the other tabs.
    const wins = list.filter((t) => t.pnl > 0), losses = list.filter((t) => t.pnl < 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const fees = list.reduce((s, t) => s + (t.fees || 0), 0);
    const net = list.reduce((s, t) => s + t.pnl, 0);
    const m = manual.find((x) => x.date === date);
    let cum = 0;
    const points = list.map((t, i) => { cum += t.pnl; return { i: i + 1, cum: r2(cum) }; });
    // All screenshots from the day's trades (view-only on the Daily Log).
    const screenshots = list.flatMap((t) => { try { return JSON.parse(t.screenshots || '[]'); } catch { return []; } });
    return {
      date,
      net: r2(net + (m ? m.pnl : 0)),
      trades: list.length + (m && !list.length ? (m.trades || 0) : 0),
      winners: list.filter(isWin).length,
      losers: list.filter(isLoss).length,
      winRate: winRatePct(list),
      gross: r2(net + fees),
      fees: r2(fees),
      volume: list.reduce((s, t) => s + (t.qty || 0), 0),
      profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : (grossWin > 0 ? null : 0),
      manual: m ? r2(m.pnl) : null,
      note: logs[date] || '',
      points,
      screenshots,
    };
  });
  return out;
}

// Cross-account portfolio overview — one compact summary row per journal for
// the all-accounts screen.
export function overviewAll() {
  // Active accounts only — archived (passed/blown) live in the Archive view.
  const journals = db.prepare('SELECT * FROM journals WHERE COALESCE(archived, 0) = 0 ORDER BY id').all();
  return journals.map((j) => {
    const c = challenge(j.id);
    const equity = c.drawdown.threshold + c.drawdown.distance;
    return {
      id: j.id, name: j.name, firm: j.firm, phase: j.phase,
      status: c.status, headline: c.headline,
      startBalance: j.start_balance,
      profit: c.profit, target: c.target, targetPct: c.targetPct,
      equity: r2(equity), distance: c.drawdown.distance, breachedOn: c.drawdown.breachedOn,
      tradingDays: c.tradingDays, passedOn: c.passedOn,
      payoutEligible: c.payout ? c.payout.eligible : null,
      payoutsTaken: c.payout ? c.payout.taken : null,
    };
  });
}

// Pattern DISCOVERY engine. Slices trades across many dimensions and surfaces
// the buckets whose win-rate / expectancy deviate hard from the overall
// baseline — "entries before 10:00 lose 80% of the time" type findings — with
// enough sample size to mean something. Returns ranked, plain-language insights.
export function insights(journalId) {
  const trades = allTrades(journalId).filter((t) => t.entry_time);
  const n = trades.length;
  const MIN_BUCKET = 5;          // ignore buckets smaller than this
  const MIN_TOTAL = 12;          // engine needs some history to be meaningful
  if (n < MIN_TOTAL) return { ready: false, total: n, need: MIN_TOTAL, insights: [] };

  // Baseline win rate uses the break-even band (shared isWin/isLoss) so the
  // "your overall win rate is X%" line matches the Dashboard exactly. baseWin is
  // a fraction over DECISIVE trades (scratches excluded from both sides).
  const decisiveN = trades.filter((t) => isWin(t) || isLoss(t)).length;
  const baseWin = decisiveN ? trades.filter(isWin).length / decisiveN : 0;

  // Per-trade derived attributes (sequence within the trading day).
  const byDay = {};
  for (const t of trades) (byDay[(t.exit_time || '').slice(0, 10)] ??= []).push(t);
  for (const d of Object.keys(byDay)) {
    const list = byDay[d].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
    list.forEach((t, i) => {
      t._idxInDay = i;
      t._prev = i > 0 ? list[i - 1] : null;
    });
  }

  const hour = (iso) => new Date(iso).getHours();
  const dims = [
    { dim: 'Entry time', of: (t) => {
      const h = hour(t.entry_time);
      if (h < 9) return 'before 09:00';
      if (h < 10) return '09:00–09:59';
      if (h < 11) return '10:00–10:59';
      if (h < 12) return '11:00–11:59';
      if (h < 14) return '12:00–13:59';
      return '14:00 or later';
    } },
    { dim: 'Hold time', of: (t) => t.duration_s == null ? null
      : t.duration_s < 60 ? 'under 1 min'
      : t.duration_s < 300 ? '1–5 min'
      : t.duration_s < 900 ? '5–15 min'
      : t.duration_s < 3600 ? '15–60 min' : 'over 60 min' },
    { dim: 'Direction', of: (t) => t.direction === 'long' ? 'longs' : 'shorts' },
    { dim: 'Instrument', of: (t) => t.product },
    { dim: 'Position size', of: (t) => t.qty <= 1 ? '1 contract' : t.qty <= 3 ? '2–3 contracts' : '4+ contracts' },
    { dim: 'Weekday', of: (t) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t.exit_time).getDay()] },
    { dim: 'Sequence', of: (t) => !t._prev ? 'first trade of the day' : (t._prev.pnl > 0 ? 'right after a win' : 'right after a loss') },
    { dim: 'Trade # of day', of: (t) => t._idxInDay < 2 ? '1st–2nd of the day' : t._idxInDay < 5 ? '3rd–5th of the day' : '6th+ of the day' },
  ];

  const out = [];
  for (const { dim, of } of dims) {
    const groups = {};
    for (const t of trades) {
      const b = of(t);
      if (b == null) continue;
      (groups[b] ??= []).push(t);
    }
    for (const [bucket, list] of Object.entries(groups)) {
      if (list.length < MIN_BUCKET) continue;
      // Bucket win rate uses the same break-even band as the baseline, so the
      // deviation (dWin) compares like with like.
      const wins = list.filter(isWin).length;
      const decisive = wins + list.filter(isLoss).length;
      const winRate = decisive ? wins / decisive : 0;
      const pnl = list.reduce((s, t) => s + t.pnl, 0);
      const expectancy = pnl / list.length;
      const dWin = winRate - baseWin;
      // Worth surfacing only if the win-rate gap is real OR it's clearly bleeding money.
      const strong = Math.abs(dWin) >= 0.15 || (expectancy < 0 && pnl <= -100);
      if (!strong) continue;
      const good = dWin > 0 && pnl > 0;
      out.push({
        dim, bucket, n: list.length,
        winRate: r2(winRate * 100), lossRate: r2((1 - winRate) * 100),
        pnl: r2(pnl), expectancy: r2(expectancy),
        baseWin: r2(baseWin * 100), deltaWin: r2(dWin * 100),
        tone: good ? 'good' : 'bad',
        small: list.length < 10,
        impact: Math.abs(pnl),
      });
    }
  }

  // Rank: biggest dollar impact first; bad before good on ties.
  out.sort((a, b) => b.impact - a.impact || (a.tone === 'bad' ? -1 : 1));
  return { ready: true, total: n, baseWin: r2(baseWin * 100), insights: out.slice(0, 10) };
}

// "Film Room" review — answers the three questions the trader cares about by
// aggregating their own per-trade reads (trade_meta.direction_call / entry_timing
// / market_move / intuition / mfe_points) against realized P&L:
//   1. Right on direction but entered too early — count + $ + points left on table
//   2. Which market MOVE makes the most money — P&L/expectancy by move type
//   3. Where intuition fails — gut trades vs plan, and which moves the gut misreads
// Only reviewed trades (those with at least one field tagged) feed the analysis;
// the film-room strip shows every trade that has a screenshot.
export function review(journalId) {
  const rows = db.prepare(`
    SELECT t.id, t.contract, t.direction, t.qty, t.pnl, t.points, t.entry_time, t.exit_time, t.clip_only,
           m.direction_call, m.entry_timing, m.market_move, m.intuition, m.mfe_points,
           m.setup, m.notes, m.rating, m.mistakes, m.screenshots, m.video
    FROM trades t LEFT JOIN trade_meta m ON m.trade_id = t.id
    WHERE t.journal_id = ? AND t.exit_time IS NOT NULL
    ORDER BY t.exit_time DESC
  `).all(journalId);

  // Analytics/coverage count only REAL trades; clip_only placeholders are kept
  // in `rows` solely so their video still surfaces in the film strip below.
  const realRows = rows.filter((r) => !r.clip_only);

  const reviewed = realRows.filter((r) =>
    r.direction_call || r.entry_timing || r.market_move || r.intuition || r.mfe_points != null);

  const agg = (list) => ({
    n: list.length,
    pnl: r2(list.reduce((s, t) => s + t.pnl, 0)),
    avgPnl: list.length ? r2(list.reduce((s, t) => s + t.pnl, 0) / list.length) : null,
    winRate: winRatePct(list), // break-even-adjusted (see BE_BAND)
  });
  const groupBy = (list, key, order) => {
    const g = {};
    for (const t of list) { if (!t[key]) continue; (g[t[key]] ??= []).push(t); }
    let entries = Object.entries(g).map(([k, v]) => ({ key: k, ...agg(v) }));
    if (order) entries.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    else entries.sort((a, b) => b.pnl - a.pnl);
    return entries;
  };

  // --- Q1: right direction, entered too early -------------------------------
  const rightDir = reviewed.filter((t) => t.direction_call === 'right');
  const earlyRight = rightDir.filter((t) => t.entry_timing === 'early');
  // Points left on the table = how far it ran your way (mfe) minus what you kept.
  const withMfe = earlyRight.filter((t) => t.mfe_points != null && t.points != null);
  const pointsLeft = r2(withMfe.reduce((s, t) => s + Math.max(0, t.mfe_points - Math.abs(t.points)), 0));
  const earlyButRight = {
    ...agg(earlyRight),
    rightDirN: rightDir.length,
    shareOfRight: rightDir.length ? r2((earlyRight.length / rightDir.length) * 100) : null,
    pointsLeftOnTable: pointsLeft,
    withMfeN: withMfe.length,
  };

  // --- Q2: P&L by market movement -------------------------------------------
  const byMove = groupBy(reviewed, 'market_move');

  // --- Q3: where intuition fails --------------------------------------------
  const gut = reviewed.filter((t) => t.intuition === 'gut');
  const plan = reviewed.filter((t) => t.intuition === 'plan');
  const intuition = {
    gut: agg(gut),
    plan: agg(plan),
    gutByMove: groupBy(gut, 'market_move'),     // which contexts the gut misreads
    gutByDirection: groupBy(gut, 'direction_call', ['right', 'wrong']),
  };

  // --- timing distribution (context for Q1) ---------------------------------
  const byTiming = groupBy(reviewed, 'entry_timing', ['early', 'good', 'late', 'chased']);
  const byDirectionCall = groupBy(reviewed, 'direction_call', ['right', 'wrong']);

  // --- film-room strip: any trade with a clip or screenshot, newest first ----
  const filmRoom = rows
    .map((t) => {
      let shots = [];
      try { shots = JSON.parse(t.screenshots || '[]'); } catch {}
      return { ...t, shots };
    })
    .filter((t) => t.shots.length || t.video)
    .map((t) => ({
      id: t.id, contract: t.contract, direction: t.direction, qty: t.qty,
      pnl: r2(t.pnl), points: t.points, entry_time: t.entry_time, exit_time: t.exit_time,
      direction_call: t.direction_call, entry_timing: t.entry_timing,
      market_move: t.market_move, intuition: t.intuition, mfe_points: t.mfe_points,
      setup: t.setup, rating: t.rating, mistakes: t.mistakes, notes: t.notes,
      screenshots: t.shots, video: t.video || null,
    }));

  return {
    total: realRows.length,
    reviewedN: reviewed.length,
    coverage: realRows.length ? r2((reviewed.length / realRows.length) * 100) : 0,
    earlyButRight,
    byMove,
    byTiming,
    byDirectionCall,
    intuition,
    filmRoom,
  };
}

// Challenge / payout scoreboard — the "am I passing, and what's left?" view.
// Combines the firm's rules (profit target, trailing drawdown, consistency,
// qualifying days) into one verdict + a checklist with the exact $ remaining.
export function challenge(journalId) {
  const j = getJournal(journalId) || {};
  const eq = equity(journalId);            // daily {date, pnl, cum}
  const rk = risk(journalId);              // trailing-dd sim

  const profit = eq.length ? eq[eq.length - 1].cum : 0;
  const target = j.profit_target || 0;

  // --- Profit target ---
  const targetMet = target > 0 ? profit >= target : true;
  const targetRemaining = Math.max(0, target - profit);
  // An EVAL ends the moment you hit the target — you pass and move to a funded
  // account (Apex PA). So find the FIRST day cumulative profit reached the
  // target: that's the pass point, and trades after it wouldn't be on the eval.
  let passedOn = null, profitAtPass = null, daysAfterPass = 0;
  if (j.phase !== 'funded' && target > 0) {
    for (const d of eq) {
      if (d.cum >= target) { passedOn = d.date; profitAtPass = r2(d.cum); break; }
    }
    if (passedOn) daysAfterPass = eq.filter((d) => d.date > passedOn).length;
  }

  // --- Payout cycle: the qualifying-day count AND the consistency window both
  // RESET after every approved payout, so we only count days AFTER the last
  // payout's date (or since account inception if no payout has been made). ---
  const payoutRows = db.prepare('SELECT date, amount, note FROM payouts WHERE journal_id = ? ORDER BY date, id').all(journalId);
  const lastPayoutDate = payoutRows.length ? payoutRows[payoutRows.length - 1].date : null;
  const cycleDays = eq.filter((d) => !lastPayoutDate || d.date > lastPayoutDate);
  const cycleNet = cycleDays.reduce((s, d) => s + d.pnl, 0);

  // --- Consistency (funded payout rule): the largest single winning DAY must be
  // ≤ the cap% of NET PROFIT SINCE THE LAST PAYOUT (or inception) — Apex = 50%.
  // Lucid adds a small "cushion" (extra pp of slack). Resets each payout cycle.
  // Easy form: you need cycle net profit ≥ biggestDay / cap (a $1,500 day on a
  // 50% rule needs $3,000 of net profit). Below the threshold → not payable.
  const cpct = j.consistency_pct || 0;
  let consistency = null;
  if (cpct > 0) {
    const cushionPP = j.consistency_cushion_pct || 0;
    const effPct = cpct + cushionPP;            // effective cap (e.g. 52)
    const cap = effPct / 100;
    const cycleGreen = cycleDays.filter((d) => d.pnl > 0);
    const cycleBestDay = cycleGreen.length ? Math.max(...cycleGreen.map((d) => d.pnl)) : 0;
    const bestDayShare = cycleNet > 0 ? cycleBestDay / cycleNet : (cycleBestDay > 0 ? 1 : 0);
    const requiredTotal = cycleBestDay > 0 ? cycleBestDay / cap : 0; // net profit needed to legitimize the biggest day
    const maxDayAtTarget = target > 0 ? target * cap : null;         // biggest day allowed at the target (evals)
    // Consistency ceiling on any SINGLE day: the largest day must be ≤ cap% of
    // TOTAL profit (Lucid/Apex rule: largest day / total ≤ 50%). At the current
    // profit that ceiling is simply cap × cycleNet (e.g. 50% of $3,150 = $1,575).
    const maxDay = cycleNet > 0 ? r2(cycleNet * cap) : 0;
    consistency = {
      pct: cpct,
      cushionPct: cushionPP,
      effectivePct: effPct,
      bestDay: r2(cycleBestDay),
      bestDayShare: r2(bestDayShare * 100),
      compliant: bestDayShare <= cap + 1e-9,
      cycleNet: r2(cycleNet),
      requiredTotal: r2(requiredTotal),
      additionalNeeded: r2(Math.max(0, requiredTotal - cycleNet)),
      maxDay,
      maxDayAtTarget: maxDayAtTarget == null ? null : r2(maxDayAtTarget),
    };
  }

  // --- Qualifying days (payout): days in THIS cycle with pnl ≥ threshold ---
  let qualifying = null;
  if (j.min_profit_days > 0) {
    const amt = j.min_profit_day_amount || 0;
    const have = cycleDays.filter((d) => d.pnl >= amt && d.pnl > 0).length;
    qualifying = {
      need: j.min_profit_days,
      amount: amt,
      have,
      remaining: Math.max(0, j.min_profit_days - have),
      met: have >= j.min_profit_days,
    };
  }

  // Gate flags — shared by payout eligibility and the overall verdict.
  const consistencyOk = !consistency || consistency.compliant;
  const qualifyingOk = !qualifying || qualifying.met;

  // --- Payout readiness (funded phase) ---
  let payout = null;
  if (j.phase === 'funded' || payoutRows.length || j.min_payout || j.payout_cap || j.max_payouts) {
    const taken = payoutRows.length;
    const maxPayouts = j.max_payouts || 0;
    const balance = rk.currentBalance;
    const half = balance * 0.5;
    const cap = j.payout_cap || 0;
    const maxRequest = cap > 0 ? Math.min(half, cap) : half;
    // You can only withdraw realized profit; also bounded by current-cycle net.
    const available = Math.max(0, Math.min(maxRequest, cycleNet));
    const minReq = j.min_payout || 0;
    // Apex: the 50% consistency rule must also hold, or the payout option is hidden.
    const eligible = !rk.breachedOn && qualifyingOk && consistencyOk && cycleNet > 0 && available >= minReq && (maxPayouts === 0 || taken < maxPayouts);
    payout = {
      taken,
      maxPayouts,
      remaining: maxPayouts > 0 ? Math.max(0, maxPayouts - taken) : null,
      movedLive: maxPayouts > 0 && taken >= maxPayouts,
      cycleNet: r2(cycleNet),
      cycleNetPositive: cycleNet > 0,
      lastPayoutDate,
      minPayout: minReq,
      payoutCap: cap,
      maxRequest: r2(maxRequest),
      available: r2(available),
      eligible,
      history: payoutRows,
      totalPaid: r2(payoutRows.reduce((s, p) => s + p.amount, 0)),
    };
  }

  // --- Daily loss limit: days that CLOSED at/below the limit (day-granularity) ---
  const dll = j.daily_loss_limit || 0;
  const dllBreaches = dll > 0 ? eq.filter((d) => d.pnl <= -dll).length : 0;

  // --- Room today: most you can STILL lose right now before (a) breaching the
  // trailing threshold or (b) hitting the daily loss limit — whichever is
  // closer. Subtracts what you've already lost TODAY, so it's a live "stop for
  // the day" number, not a fresh-session figure. ---
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayRow = eq.find((d) => d.date === todayKey);
  const todayPnl = todayRow ? todayRow.pnl : 0;
  const todayLoss = Math.max(0, -todayPnl);
  const dllRoom = dll > 0 ? Math.max(0, dll - todayLoss) : Infinity;
  const roomToday = Math.min(rk.distance, dllRoom);

  // --- Overall verdict ---
  let status, headline;
  if (rk.breachedOn) {
    status = 'failed';
    headline = `Account blown — trailing drawdown breached on ${rk.breachedOn}.`;
  } else if (targetMet && consistencyOk && qualifyingOk) {
    status = 'passed';
    headline = j.phase === 'funded' ? 'Payout requirements met. 🎉' : 'Challenge passed. 🎉';
  } else {
    status = 'progress';
    const bits = [];
    if (!targetMet) bits.push(`${money(targetRemaining)} more profit`);
    if (consistency && !consistency.compliant) bits.push(`${money(consistency.additionalNeeded)} more to fix consistency`);
    if (qualifying && !qualifying.met) bits.push(`${qualifying.remaining} more qualifying day(s)`);
    headline = `In progress — need ${bits.join(', ')}.`;
  }

  return {
    firm: j.firm || null,
    phase: j.phase || 'eval',
    profit: r2(profit),
    target,
    targetMet,
    targetRemaining: r2(targetRemaining),
    targetPct: target > 0 ? r2(Math.min(100, (profit / target) * 100)) : null,
    passedOn,
    profitAtPass,
    daysAfterPass,
    drawdown: {
      trailingDd: rk.trailingDd,
      distance: rk.distance,
      minDistance: rk.minDistance,
      threshold: rk.currentThreshold,
      breachedOn: rk.breachedOn,
    },
    consistency,
    qualifying,
    payout,
    dailyLossLimit: dll,
    dllBreaches,
    todayPnl: r2(todayPnl),
    roomToday: r2(roomToday),
    tradingDays: eq.length,
    status,
    headline,
  };
}

// Everything the Edgewonk-style home dashboard needs in one call.
export function dashboard(journalId) {
  const trades = allTrades(journalId);
  const sum = summary(journalId);
  const eq = equity(journalId);
  const pat = patterns(journalId);
  const start = getJournal(journalId)?.start_balance || 0;

  // Win/loss/break-even split uses the shared break-even band (see BE_BAND).
  const wins = trades.filter(isWin);
  const losses = trades.filter(isLoss);
  const be = trades.length - wins.length - losses.length;

  const holds = trades.filter((t) => t.duration_s != null);
  const avgHoldS = holds.length ? holds.reduce((s, t) => s + t.duration_s, 0) / holds.length : null;

  // Max drawdown % off the running equity peak (incl. start balance).
  let peak = start, maxDdPct = 0;
  for (const d of eq) {
    const bal = start + d.cum;
    peak = Math.max(peak, bal);
    if (peak > 0) maxDdPct = Math.max(maxDdPct, ((peak - bal) / peak) * 100);
  }

  const weeks = new Set(eq.map((d) => isoWeek(d.date)));
  const greenDays = eq.filter((d) => d.pnl > 0).length;
  const redDays = eq.filter((d) => d.pnl < 0).length;

  // Net P&L includes manual days (equity is the source of truth for money);
  // per-trade stats (winrate, PF, streaks…) stay trade-based.
  const totalAll = eq.length ? eq[eq.length - 1].cum : 0;

  const last5 = trades.slice(-5).map((t) => (isWin(t) ? 'W' : isLoss(t) ? 'L' : 'B'));

  // Discipline score 0-100: start perfect, lose points for the patterns that
  // blow accounts — revenge share, sizing up after losses, trading past the
  // daily limit, and red-day overtrading.
  let score = 100;
  if (trades.length) score -= Math.min(35, (pat.revenge.trades / trades.length) * 120);
  if (pat.avgSizeAfterLoss != null && pat.avgSizeOther != null && pat.avgSizeOther > 0) {
    score -= Math.min(20, Math.max(0, (pat.avgSizeAfterLoss / pat.avgSizeOther - 1) * 50));
  }
  if (eq.length) score -= Math.min(30, (pat.breachDays / eq.length) * 150);
  if (pat.avgTradesRedDay != null && pat.avgTradesGreenDay > 0) {
    score -= Math.min(15, Math.max(0, (pat.avgTradesRedDay / pat.avgTradesGreenDay - 1) * 20));
  }
  score = Math.max(0, Math.round(score));

  // Plain-language issue list for the banner.
  const issues = [];
  if (pat.revenge.trades > 0 && (pat.revenge.avgPnl ?? 0) < (pat.nonRevenge.avgPnl ?? 0)) {
    issues.push(`Quick re-entries after losses average ${pat.revenge.avgPnl < 0 ? '-' : ''}$${Math.abs(pat.revenge.avgPnl)} per trade`);
  }
  if (pat.avgSizeAfterLoss != null && pat.avgSizeOther != null && pat.avgSizeAfterLoss > pat.avgSizeOther * 1.15) {
    issues.push('Position size grows right after losses');
  }
  if (pat.breachDays > 0) issues.push(`Daily loss limit breached on ${pat.breachDays} day(s), costing $${Math.abs(pat.lossAfterBreach)} past the breach`);
  if (pat.avgTradesRedDay != null && pat.avgTradesGreenDay != null && pat.avgTradesRedDay > pat.avgTradesGreenDay * 1.3) {
    issues.push('Red days have significantly more trades than green days');
  }

  const paidOut = db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM payouts WHERE journal_id = ?').get(journalId).t;

  return {
    ...sum,
    totalPnl: r2(totalAll),
    paidOut: r2(paidOut),
    startBalance: start,
    equity: eq,
    byDow: pat.byDow,
    counts: { wins: wins.length, losses: losses.length, be },
    winRateNoBe: winRatePct(trades),
    biggestWin: trades.length ? r2(Math.max(...trades.map((t) => t.pnl))) : null,
    biggestLoss: trades.length ? r2(Math.min(...trades.map((t) => t.pnl))) : null,
    avgHoldS: avgHoldS == null ? null : Math.round(avgHoldS),
    avgProfitPerDay: eq.length ? r2(totalAll / eq.length) : null,
    roiPct: start > 0 ? r2((totalAll / start) * 100) : null,
    maxDdPct: r2(maxDdPct),
    greenDays,
    redDays,
    tradesPerDay: eq.length ? r2(trades.length / eq.length) : null,
    tradesPerWeek: weeks.size ? r2(trades.length / weeks.size) : null,
    last5,
    score,
    issues,
  };
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const firstThu = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${week}`;
}

const r2 = (n) => Math.round(n * 100) / 100;

// Archived accounts (passed/blown) + a headline summary for each, for the
// Archive view and tax records. Data is never deleted — just flagged.
export function archiveList() {
  const rows = db.prepare('SELECT * FROM journals WHERE archived = 1 AND COALESCE(is_library, 0) = 0 ORDER BY archived_at DESC, id DESC').all();
  return rows.map((j) => {
    const s = summary(j.id);
    const days = equity(j.id);
    return {
      ...j,
      totalPnl: s.totalPnl,
      trades: s.trades,
      winRate: s.winRate,
      profitFactor: s.profitFactor,
      firstDay: days.length ? days[0].date : null,
      lastDay: days.length ? days[days.length - 1].date : null,
    };
  });
}
