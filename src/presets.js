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
PRESETS['mffu-50k'] = {
  label: 'My Funded Futures 50K (verify)',
  firm: 'MFFU', phase: 'eval',
  start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
  dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 0,
  consistency_pct: 0, consistency_cushion_pct: 0, min_profit_days: 5, min_profit_day_amount: 150, max_contracts: 6,
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
