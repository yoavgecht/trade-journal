export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
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
