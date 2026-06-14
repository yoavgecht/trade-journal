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
const APEX_EOD = {
  '25K': { start: 25000, target: 1500, dd: 1000, dll: 500, evalContracts: 4, paContracts: 2 },
  '50K': { start: 50000, target: 3000, dd: 2000, dll: 1000, evalContracts: 6, paContracts: 4 },
  '100K': { start: 100000, target: 6000, dd: 3000, dll: 1500, evalContracts: 8, paContracts: 6 },
  '150K': { start: 150000, target: 9000, dd: 4000, dll: 2000, evalContracts: 12, paContracts: 10 },
};

const PRESETS = {};
for (const [size, a] of Object.entries(APEX_EOD)) {
  PRESETS[`apex-${size}-eval`] = {
    label: `Apex ${size} — EOD Eval (Tradovate)`,
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
    consistency_pct: 30, consistency_cushion_pct: 0, min_profit_days: 0, min_profit_day_amount: 0,
    max_contracts: a.paContracts,
  };
}

// Other firms (50K shown; verify their stop rule).
PRESETS['lucid-50k-flex-eval'] = {
  label: 'Lucid 50K — Flex Eval',
  firm: 'Lucid', phase: 'eval',
  start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
  dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 0,
  consistency_pct: 50, consistency_cushion_pct: 2, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 4,
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

export { PRESETS };
