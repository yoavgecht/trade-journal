// Prop-firm rule presets for the Create-a-Journal form. These pre-fill the
// challenge rules — ALWAYS verify against your firm's current rules (they
// change), every field stays editable after you pick one. Numbers reflect the
// common 50K accounts the user trades (Lucid taken from their screenshots).
export const PRESETS = {
  'lucid-50k-eod': {
    label: 'Lucid 50K — No-Activation EOD Trail',
    firm: 'Lucid', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stops_at_start: true, daily_loss_limit: 1000,
    consistency_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 6,
  },
  'lucid-50k-flex-eval': {
    label: 'Lucid 50K — Flex Eval',
    firm: 'Lucid', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stops_at_start: true, daily_loss_limit: 0,
    consistency_pct: 50, consistency_cushion_pct: 2, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 4,
  },
  'lucid-50k-flex-funded': {
    label: 'Lucid 50K — Flex Funded (payout)',
    firm: 'Lucid', phase: 'funded',
    start_balance: 50000, profit_target: 0, trailing_dd: 2000,
    dd_stops_at_start: true, daily_loss_limit: 0,
    consistency_pct: 0, min_profit_days: 5, min_profit_day_amount: 150, max_contracts: 4,
  },
  'apex-50k-eval': {
    label: 'Apex 50K — Eval (verify)',
    firm: 'Apex', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2500,
    dd_stops_at_start: true, daily_loss_limit: 0,
    consistency_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 10,
  },
  'apex-50k-pa': {
    label: 'Apex 50K — PA / Funded (verify)',
    firm: 'Apex', phase: 'funded',
    start_balance: 50000, profit_target: 0, trailing_dd: 2500,
    dd_stops_at_start: true, daily_loss_limit: 0,
    consistency_pct: 30, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 10,
  },
  'mffu-50k': {
    label: 'My Funded Futures 50K (verify)',
    firm: 'MFFU', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stops_at_start: true, daily_loss_limit: 0,
    consistency_pct: 0, min_profit_days: 5, min_profit_day_amount: 150, max_contracts: 6,
  },
  custom: {
    label: 'Custom',
    firm: '', phase: 'eval',
    start_balance: 50000, profit_target: 3000, trailing_dd: 2000,
    dd_stops_at_start: true, daily_loss_limit: 0,
    consistency_pct: 0, min_profit_days: 0, min_profit_day_amount: 0, max_contracts: 0,
  },
};
