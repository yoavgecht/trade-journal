// Active journal is module-level so every data call is scoped automatically.
let activeJournal = null;
export function setActiveJournalId(id) { activeJournal = id; }
export function getActiveJournalId() { return activeJournal; }

export async function api(path, opts = {}) {
  let url = `/api${path}`;
  const needsScope = activeJournal && !path.startsWith('/journals') && !path.startsWith('/products');
  if (needsScope) url += (url.includes('?') ? '&' : '?') + `journal=${activeJournal}`;
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export const fmt = (n, opts = {}) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2, ...opts });

export const money = (n) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// Break-even band — must match BE_BAND in server/stats.js. A trade is a win/loss
// only if |pnl| exceeds this; within ±BE_BAND it's scratch and excluded from
// win-rate math (numerator AND denominator) so every tab reports the same rate.
export const BE_BAND = 10;
export const winRatePct = (list) => {
  const w = list.filter((t) => t.pnl > BE_BAND).length;
  const l = list.filter((t) => t.pnl < -BE_BAND).length;
  return w + l ? Math.round((w / (w + l)) * 100) : 0;
};
