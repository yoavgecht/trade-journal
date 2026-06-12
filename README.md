# Trade Journal

Personal local-only trading journal/dashboard for NQ & ES futures (prop accounts
on Tradovate — Apex, Lucid, etc.). Your data never leaves your machine: it lives
in `journal.db` (SQLite) next to this file.

## Run

```bash
npm install
npm run dev        # → http://localhost:5173
```

## Getting your trades in

In Tradovate: **Reports → Fills** (preferred) or **Reports → Performance** →
export CSV → drag the file onto the Overview page. Both formats are detected
automatically:

- **Fills** — raw fills are FIFO-paired into round-trip trades here. Re-imports
  are deduped, so exporting overlapping date ranges is safe.
- **Performance** — pre-paired trades, imported as-is.

`sample-data/fills-sample.csv` is fake data to try the dashboard with
(Settings → Delete all data when done).

## Views

- **Overview** — equity curve, daily P&L, win rate / profit factor / expectancy,
  per-instrument breakdown.
- **Patterns** — P&L by hour and weekday, revenge-trade detection (entries ≤5 min
  after a loss), sizing-up-after-losses check, overtrading on red days, the cost
  of trading past your personal daily loss limit, and the dollar cost of each
  tagged mistake.
- **Risk** — Apex-style end-of-day trailing drawdown simulation: balance vs the
  trailing liquidation threshold, current distance, closest approach.
- **Trades** — every round trip; click one to tag setups/mistakes and write notes.
- **Settings** — account rules (start balance, trailing DD, personal daily loss
  limit), per-instrument point values and round-trip fees.

## Notes

- Fills exports don't include commissions — set round-trip fees per instrument
  in Settings (defaults are typical Tradovate/Apex all-in rates) and re-import
  to apply.
- The trailing-drawdown sim is day-granularity (intraday excursions between
  fills aren't visible from fills data).
