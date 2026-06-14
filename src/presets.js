// Prop-firm rule presets for the Create-a-Journal form. These pre-fill the
// challenge rules — ALWAYS verify against your firm's current rules (they
// change), every field stays editable after you pick one.
//
// dd_stop_mode — where the EOD trailing threshold stops climbing:
//   'never'  → trails the peak EOD balance forever (Apex Tradovate evals)
//   'buffer' → locks at start + dd_buffer (PA/funded; Apex = $100)
//   'target' → locks at start + profit_target (Apex Rithmic/WealthCharts evals)
export const PRESETS = {
  // EOD Evaluation params (50K): target $3,000 · EOD drawdown $2,000 · DLL
  // $1,000 · 6 contracts · 30-day access · no consistency, no min days.
  'apex-50k-eval': {
    label: 'Apex 50K — EOD Eval (Tradovate)',
    firm: 'Apex', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 1000,
    consistency_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 6,
  },
  'apex-50k-eval-rithmic': {
    label: 'Apex 50K — EOD Eval (Rithmic/WealthCharts)',
    firm: 'Apex', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stop_mode: 'target', dd_buffer: 100, daily_loss_limit: 1000,
    consistency_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 6,
  },
  'apex-50k-pa': {
    label: 'Apex 50K — EOD PA / Funded',
    firm: 'Apex', phase: 'funded',
    start_balance: 50000, profit_target: 0, trailing_dd: 2000,
    dd_stop_mode: 'buffer', dd_buffer: 100, daily_loss_limit: 1000,
    consistency_pct: 30, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 6,
  },
  'lucid-50k-flex-eval': {
    label: 'Lucid 50K — Flex Eval (verify stop rule)',
    firm: 'Lucid', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 0,
    consistency_pct: 50, consistency_cushion_pct: 2, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 4,
  },
  'lucid-50k-flex-funded': {
    label: 'Lucid 50K — Flex Funded (payout, verify)',
    firm: 'Lucid', phase: 'funded',
    start_balance: 50000, profit_target: 0, trailing_dd: 2000,
    dd_stop_mode: 'buffer', dd_buffer: 100, daily_loss_limit: 0,
    consistency_pct: 0, min_profit_days: 5, min_profit_day_amount: 150, max_contracts: 4,
    min_payout: 500, payout_cap: 2000, max_payouts: 5,
  },
  'mffu-50k': {
    label: 'My Funded Futures 50K (verify)',
    firm: 'MFFU', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 0,
    consistency_pct: 0, min_profit_days: 5, min_profit_day_amount: 150, max_contracts: 6,
  },
  custom: {
    label: 'Custom',
    firm: '', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stop_mode: 'never', dd_buffer: 100, daily_loss_limit: 0,
    consistency_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 0,
  },
};
