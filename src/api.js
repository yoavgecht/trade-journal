import { getAuthToken } from './firebase-auth.js';

// Active journal is module-level so every data call is scoped automatically.
let activeJournal = null;
export function setActiveJournalId(id) { activeJournal = id; }
export function getActiveJournalId() { return activeJournal; }

export async function api(path, opts = {}) {
  const apiBase = (import.meta?.env?.VITE_API_URL || '').replace(/\/$/, '');
  let url = `${apiBase || ''}/api${path}`;
  const needsScope = activeJournal && !path.startsWith('/journals') && !path.startsWith('/products');
  if (needsScope) url += (url.includes('?') ? '&' : '?') + `journal=${activeJournal}`;

  let sessionToken = null;
  try { sessionToken = await getAuthToken(); } catch {}

  const headers = {
    ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}`, 'X-Session-Token': sessionToken } : {}),
    ...(opts.headers || {}),
  };

  const res = await fetch(url, {
    credentials: apiBase ? 'include' : 'same-origin',
    ...opts,
    headers,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export const fmt = (n, opts = {}) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2, ...opts });

// Every stored time is ALREADY New York wall-clock ("YYYY-MM-DDTHH:MM:SS", no
// zone — the server converts imports, see server/time.js). So hours/dates are
// read straight off the string; never re-convert from the browser's zone.
export const fmtNY = (iso) => (iso ? String(iso).slice(11, 16) : '—');

const nyWallFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
// "YYYY-MM-DDTHH:MM" for now in New York (datetime-local inputs, defaults).
export function nyNow() {
  const o = {};
  for (const p of nyWallFmt.formatToParts(new Date())) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
}
export const nyToday = () => nyNow().slice(0, 10);

// The browser's time zone — sent with CSV imports so the server can convert
// the export's local times to New York.
export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Resolve a media filename to a browser-loadable URL (signed Storage URL on the
// web, static local path in dev). <img>/<video> tags can't attach Authorization
// headers, so components resolve through this authenticated endpoint instead.
// Signed URLs expire after 1h, so the cache refreshes well before that.
const mediaCache = new Map(); // key -> { url, expires }
const MEDIA_TTL = 50 * 60 * 1000;
export function mediaUrl(name) {
  if (!name) return Promise.resolve(null);
  const key = String(name);
  const hit = mediaCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  const url = api(`/media/${encodeURIComponent(key)}`).then((r) => r.url).catch(() => null);
  mediaCache.set(key, { url, expires: Date.now() + MEDIA_TTL });
  return url;
}

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
