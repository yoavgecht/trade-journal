// Prop-firm rule presets. Picking one fills EVERY rule — you never hand-enter
// parameters when creating an account; the firm + size + type already define
// them. (Verify against your firm's current rules; all fields stay editable in
// Settings for edge cases.)
//
// dd_stop_mode — where the EOD trailing threshold stops climbing:
//   'never'  → trails the peak EOD balance forever (Apex Tradovate evals)
//   'buffer' → locks at start + dd_buffer (PA/funded; Apex = $100)
//   'target' → locks at start + profit_target (Apex Rithmic/WealthCharts evals)

// Apex EOD parameters per account size, straight from the published tables.
// paMinDaily = the "Min Daily Profit" a day must clear to count as one of the 5
// qualifying payout days (EOD Performance Account Payouts table). Safety Net in
// that table = start + dd + $100 (the app's trailing-DD lock level) — so the dd
// values below already reproduce it ($50K: 50,000 + 2,000 + 100 = 52,100).
const APEX_EOD = {
  '25K': { start: 25000, target: 1500, dd: 1000, dll: 500, evalContracts: 4, paContracts: 2, paMinDaily: 100 },
  '50K': { start: 50000, target: 3000, dd: 2000, dll: 1000, evalContracts: 6, paContracts: 4, paMinDaily: 250 },
  '100K': { start: 100000, target: 6000, dd: 3000, dll: 1500, evalContracts: 8, paContracts: 6, paMinDaily: 300 },
  '150K': { start: 150000, target: 9000, dd: 4000, dll: 2000, evalContracts: 12, paContracts: 10, paMinDaily: 350 },
};

const PRESETS = {};
for (const [size, a] of Object.entries(APEX_EOD)) {
  PRESETS[`apex-${size}-eval`] = {
    label: `Apex ${size} — EOD Eval`,
    firm: 'Apex', phase: 'eval',
    start_balance: a.start, profit_target: a.target, trailing_dd: a.dd,
    dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: a.dll,
    consistency_pct: 0, consistency_cushion_pct: 0, min_profit_days: 0, min_profit_day_amount: 0,
    max_contracts: a.evalContracts,
  };
  PRESETS[`apex-${size}-pa`] = {
    label: `Apex ${size} — EOD PA / Funded`,
    firm: 'Apex', phase: 'funded',
    start_balance: a.start, profit_target: 0, trailing_dd: a.dd,
    dd_stop_mode: 'buffer', dd_buffer: 100, daily_loss_limit: a.dll,
    // Apex EOD PA payout: 50% consistency rule + 5 qualifying days at the account's
    // min daily profit; $500 minimum payout, max 6 payouts (100% split).
    consistency_pct: 50, consistency_cushion_pct: 0,
    min_profit_days: 5, min_profit_day_amount: a.paMinDaily,
    max_contracts: a.paContracts, min_payout: 500, max_payouts: 6,
  };
}

// Other firms (50K shown; verify their stop rule).
PRESETS['lucid-50k-flex-eval'] = {
  label: 'Lucid 50K — Flex Eval',
  firm: 'Lucid', phase: 'eval',
  start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
  dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 0,
  consistency_pct: 50, consistency_cushion_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 4,
};
PRESETS['lucid-50k-flex-funded'] = {
  label: 'Lucid 50K — Flex Funded (payout)',
  firm: 'Lucid', phase: 'funded',
  start_balance: 50000, profit_target: 0, trailing_dd: 2000,
  dd_stop_mode: 'buffer', dd_buffer: 100, daily_loss_limit: 0,
  consistency_pct: 0, consistency_cushion_pct: 0, min_profit_days: 5, min_profit_day_amount: 150, max_contracts: 4,
  min_payout: 500, payout_cap: 2000, max_payouts: 5,
};
// My Funded Futures — from myfundedfutures.com/plans/* (Oct 2026). Each plan is
// its own firm label ("MFFU Pro", …) so passing an eval picks THAT plan's funded
// rules (fundedRulesFor matches firm + size). Funded max-loss locks at start +
// $100 (dd_stop_mode 'buffer'). MFFU has no "min $ per winning day" rule, so
// min_profit_day_amount stays 0. Rapid's FUNDED drawdown is INTRADAY trailing —
// this app models end-of-day, so treat its distance-to-floor as optimistic.
const MFFU = {
  // eval: target, dd (EOD), dll, contracts (minis), consistency %
  // funded: contracts, dll, consistency %, qualifying days, min payout, cap per cycle, payouts before live
  'Builder': {
    '25K': { start: 25000, target: 1500, dd: 1000, dll: 600, c: 2, cons: 0, fc: 2, fcons: 50, days: 2, minPay: 250, cap: 1000, payouts: 5 },
    '50K': { start: 50000, target: 3000, dd: 2000, dll: 1000, c: 4, cons: 0, fc: 4, fcons: 50, days: 2, minPay: 500, cap: 2000, payouts: 5 },
    '100K': { start: 100000, target: 6000, dd: 3000, dll: 1750, c: 6, cons: 0, fc: 6, fcons: 50, days: 2, minPay: 1000, cap: 3000, payouts: 5 },
    '150K': { start: 150000, target: 9000, dd: 4500, dll: 2500, c: 9, cons: 0, fc: 9, fcons: 50, days: 2, minPay: 1500, cap: 3500, payouts: 5 },
  },
  'Rapid': {
    '25K': { start: 25000, target: 1500, dd: 1000, dll: 0, c: 3, cons: 50, fc: 3, fcons: 0, days: 0, minPay: 500, cap: 0, payouts: 0 },
    '50K': { start: 50000, target: 3000, dd: 2000, dll: 0, c: 5, cons: 50, fc: 5, fcons: 0, days: 0, minPay: 500, cap: 0, payouts: 0 },
    '100K': { start: 100000, target: 6000, dd: 3000, dll: 0, c: 8, cons: 50, fc: 8, fcons: 0, days: 0, minPay: 500, cap: 0, payouts: 0 },
    '150K': { start: 150000, target: 9000, dd: 4500, dll: 0, c: 10, cons: 50, fc: 10, fcons: 0, days: 0, minPay: 500, cap: 0, payouts: 0 },
  },
  'Rapid EOD': {
    // Eval contract cap isn't published — funded caps used.
    '25K': { start: 25000, target: 1500, dd: 1000, dll: 0, c: 2, cons: 30, fc: 2, fcons: 0, days: 0, minPay: 500, cap: 0, payouts: 0 },
    '50K': { start: 50000, target: 3000, dd: 2000, dll: 0, c: 3, cons: 30, fc: 3, fcons: 0, days: 0, minPay: 500, cap: 0, payouts: 0 },
  },
  'Pro': {
    '50K': { start: 50000, target: 3000, dd: 2000, dll: 0, c: 3, cons: 50, fc: 3, fcons: 0, days: 0, minPay: 1000, cap: 0, payouts: 3 },
    '100K': { start: 100000, target: 6000, dd: 3000, dll: 0, c: 6, cons: 50, fc: 6, fcons: 0, days: 0, minPay: 1000, cap: 0, payouts: 3 },
    '150K': { start: 150000, target: 9000, dd: 4500, dll: 0, c: 9, cons: 50, fc: 9, fcons: 0, days: 0, minPay: 1000, cap: 0, payouts: 3 },
  },
};
for (const [plan, sizes] of Object.entries(MFFU)) {
  const firm = `MFFU ${plan}`;
  const key = plan.toLowerCase().replace(/\s+/g, '-');
  for (const [size, m] of Object.entries(sizes)) {
    PRESETS[`mffu-${key}-${size}-eval`] = {
      label: `MFFU ${plan} ${size} — Eval`,
      firm, phase: 'eval',
      start_balance: m.start, profit_target: m.target, trailing_dd: m.dd,
      dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: m.dll,
      consistency_pct: m.cons, consistency_cushion_pct: 0, min_profit_days: 0, min_profit_day_amount: 0,
      max_contracts: m.c,
    };
    PRESETS[`mffu-${key}-${size}-funded`] = {
      label: `MFFU ${plan} ${size} — Sim-Funded${plan === 'Rapid' ? ' (intraday DD)' : ''}`,
      firm, phase: 'funded',
      start_balance: m.start, profit_target: 0, trailing_dd: m.dd,
      dd_stop_mode: 'buffer', dd_buffer: 100, daily_loss_limit: m.dll,
      consistency_pct: m.fcons, consistency_cushion_pct: 0,
      min_profit_days: m.days, min_profit_day_amount: 0,
      max_contracts: m.fc, min_payout: m.minPay, payout_cap: m.cap, max_payouts: m.payouts,
    };
  }
}

// Take Profit Trader 50K — its site was down for maintenance (Oct 2026), so
// these come from consistent third-party summaries: VERIFY before relying.
// Test: $3,000 target, $2,000 EOD max loss, no daily limit, 6 minis, 50%
// consistency. PRO: INTRADAY trailing drawdown that stops at the starting
// balance (dd_buffer 0; this app models end-of-day), no consistency rule.
PRESETS['tpt-50k-test'] = {
  label: 'Take Profit Trader 50K — Test (verify)',
  firm: 'Take Profit Trader', phase: 'eval',
  start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
  dd_stop_mode: 'never', dd_buffer: 0, daily_loss_limit: 0,
  consistency_pct: 50, consistency_cushion_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 6,
};
PRESETS['tpt-50k-pro'] = {
  label: 'Take Profit Trader 50K — PRO (verify, intraday DD)',
  firm: 'Take Profit Trader', phase: 'funded',
  start_balance: 50000, profit_target: 0, trailing_dd: 2000,
  dd_stop_mode: 'buffer', dd_buffer: 0, daily_loss_limit: 0,
  consistency_pct: 0, consistency_cushion_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 6,
};
PRESETS['custom'] = {
  label: 'Custom (set rules yourself)',
  firm: '', phase: 'eval',
  start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
  dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 0,
  consistency_pct: 0, consistency_cushion_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 0,
};

// When an eval is PASSED, the new funded account must take the funded PAYOUT
// rules (winning days, consistency, payout limits) — the eval's own rules don't
// include them. Find the matching funded preset by firm + account size and
// return just its rule fields (name/firm/phase/target/size come from elsewhere).
// Fixed id prefixes firms assign to accounts. When set, the create/pass dialog
// LOCKS the prefix and the user only types the number the firm gave them:
//   challenge (eval): Apex "APEX…", Lucid "LFE…"
//   funded:           Apex "PAAPEX…"   (Lucid funded prefix TBD)
const CHALLENGE_PREFIX = { Apex: 'APEX', Lucid: 'LFE' };
const FUNDED_PREFIX = { Apex: 'PAAPEX' };

// Locked account-id prefix for a firm + phase ('eval' | 'funded'), or null.
export function accountPrefix(firm, phase) {
  return (phase === 'funded' ? FUNDED_PREFIX[firm] : CHALLENGE_PREFIX[firm]) || null;
}

export function fundedPrefix(firm) { return accountPrefix(firm, 'funded'); }

// Pre-filled name for the new funded account when an eval is passed: the fixed
// funded prefix for known firms, else a plain editable "<eval name> PA".
export function fundedNameDefault(firm, evalName) {
  return fundedPrefix(firm) || `${evalName} PA`;
}

export function fundedRulesFor(firm, startBalance) {
  const p = Object.values(PRESETS).find(
    (x) => x.phase === 'funded' && x.firm === firm && x.start_balance === startBalance);
  if (!p) return null;
  const { label, firm: _f, phase, profit_target, start_balance, ...rules } = p;
  return rules;
}

export { PRESETS };
