import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, money, fmt, getActiveJournalId } from '../api.js';
import TradePanel, { MARKET_MOVES, ENTRY_TIMINGS } from '../components/TradePanel.jsx';

const MOVE_LABEL = Object.fromEntries(MARKET_MOVES);
const TIMING_LABEL = Object.fromEntries(ENTRY_TIMINGS);
const RATING_WORD = ['', 'Poor', 'Weak', 'Solid', 'Good', 'Great'];

function Stars({ n }) {
  if (!n) return null;
  return (
    <span className="film-stars" title={`Execution: ${RATING_WORD[n]}`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= n ? 'on' : ''}>★</span>)}
    </span>
  );
}

// The review details the user filled in the edit card, shown on the clip stripe:
// execution stars, direction/timing/movement/intuition tags, mistakes, setup, notes.
function FilmDetails({ t }) {
  let mistakes = [];
  try { mistakes = JSON.parse(t.mistakes || '[]'); } catch {}
  const hasTop = t.rating > 0 || t.direction_call || t.entry_timing || t.market_move
    || t.intuition || (t.mfe_points != null && t.points != null);
  return (
    <>
      {hasTop && (
        <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <Stars n={t.rating} />
          {t.direction_call && <span className={`tag ${t.direction_call === 'right' ? 'sel' : 'on'}`}>dir {t.direction_call}</span>}
          {t.entry_timing && <span className="tag">{TIMING_LABEL[t.entry_timing] || t.entry_timing}</span>}
          {t.market_move && <span className="tag">{MOVE_LABEL[t.market_move] || t.market_move}</span>}
          {t.intuition && <span className="tag">{t.intuition === 'gut' ? 'gut feel' : 'plan'}</span>}
          {t.mfe_points != null && t.points != null && (
            <span className="muted" style={{ fontSize: 12 }}>left {Math.max(0, t.mfe_points - Math.abs(t.points)).toFixed(1)} pts</span>
          )}
        </div>
      )}
      {mistakes.length > 0 && (
        <div className="chip-row" style={{ marginTop: 6 }}>
          {mistakes.map((m) => <span key={m} className="tag mistake">{m}</span>)}
        </div>
      )}
      {t.setup && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t.setup}</div>}
      {t.notes && <div className="film-notes">{t.notes}</div>}
    </>
  );
}

const PnlCell = ({ v }) => <td className={v >= 0 ? 'pos' : 'neg'}>{money(v)}</td>;

// Create a manual trade to review (for past trades not in any CSV). Minimal
// fields — the rest (screenshots, tags, mfe) get filled in the panel that opens
// right after.
function AddTradeModal({ onCreated, onClose }) {
  const [product, setProduct] = useState('NQ');
  const [direction, setDirection] = useState('long');
  const [qty, setQty] = useState(1);
  const [pnl, setPnl] = useState('');
  const [points, setPoints] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [journalId, setJournalId] = useState(() => getActiveJournalId() || '');
  // Default to LOCAL now (not UTC — toISOString() is UTC and would shift the day/
  // hours in a datetime-local input). This is a "past trades" modal, so set the
  // day to when you actually traded.
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);

  // Account picker — active + archived, so a clip can be attributed to any account.
  useEffect(() => {
    Promise.all([api('/journals'), api('/journals/archived').catch(() => [])]).then(([act, arch]) => {
      setAccounts([...act, ...arch.map((j) => ({ ...j, _archived: true }))]);
      setJournalId((cur) => cur || (act[0] && act[0].id) || (arch[0] && arch[0].id) || '');
    });
  }, []);

  const create = async () => {
    if (!journalId) return;
    setBusy(true);
    const t = await api('/trades', {
      method: 'POST',
      body: {
        journal_id: Number(journalId),
        product, direction, qty: Number(qty),
        pnl: pnl === '' ? 0 : Number(pnl),
        points: points === '' ? null : Number(points),
        entry_time: when ? `${when}:00` : null,
        exit_time: when ? `${when}:00` : null,
      },
    });
    setBusy(false);
    onCreated(t);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onClose}>✕</button>
        <h3>Add a trade to review</h3>
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          For reviewing a past trade not in a CSV — pick the account it belongs to, then add its clip in
          the next step. This won't count as a trade (trades come only from CSV imports).
        </div>
        <div className="field-row" style={{ flexWrap: 'wrap' }}>
          <div className="field"><label>Account</label>
            <select value={journalId} onChange={(e) => setJournalId(e.target.value)}>
              {accounts.map((j) => (
                <option key={j.id} value={j.id}>{j.name}{j._archived ? ' (archived)' : ''}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row" style={{ flexWrap: 'wrap' }}>
          <div className="field"><label>Instrument</label>
            <select value={product} onChange={(e) => setProduct(e.target.value)}>
              {['NQ', 'MNQ', 'ES', 'MES'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="field"><label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="long">long</option><option value="short">short</option>
            </select>
          </div>
          <div className="field"><label>Contracts</label>
            <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>
        <div className="field-row" style={{ flexWrap: 'wrap' }}>
          <div className="field"><label>Net P&L ($)</label>
            <input type="number" step="any" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="e.g. -120" />
          </div>
          <div className="field"><label>Points (optional)</label>
            <input type="number" step="any" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 8" />
          </div>
          <div className="field"><label>When — set the day you took it</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create & review →'}</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function MoveBars({ data }) {
  const rows = data.map((d) => ({ ...d, label: MOVE_LABEL[d.key] || d.key }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows}>
        <CartesianGrid stroke="rgba(128,128,128,0.18)" strokeDasharray="3 3" />
        <XAxis dataKey="label" stroke="#6b7280" fontSize={11} />
        <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(v) => `$${v}`} />
        <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb' }} formatter={(v) => money(v)} />
        <ReferenceLine y={0} stroke="#6b7280" />
        <Bar dataKey="pnl" name="P&L">
          {rows.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#16a34a' : '#dc2626'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Review({ dataVersion }) {
  const [r, setR] = useState(null);
  const [trades, setTrades] = useState([]);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [lib, setLib] = useState([]); // cross-account clips from archived accounts
  const [theater, setTheater] = useState(null); // clip filename shown large (theater mode)
  const [v, setV] = useState(0);
  useEffect(() => {
    api('/review').then(setR);
    api('/trades?includeClips=1').then(setTrades); // include clip-only entries so the film strip can open them
    api('/film-library').then(setLib);
  }, [dataVersion, v]);
  if (!r) return null;

  const e = r.earlyButRight;
  const gut = r.intuition.gut, plan = r.intuition.plan;
  const openTrade = (id) => { const t = trades.find((x) => x.id === id); if (t) setSelected(t); };
  const delClip = async (id) => {
    if (!window.confirm('Delete this clip permanently? The video file is removed too.')) return;
    await api(`/trades/${id}`, { method: 'DELETE' });
    setV((x) => x + 1); // refetch film strip + library
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>🎬 Film Room</h1>
        <button onClick={() => setAdding(true)}>＋ Add trade to review</button>
      </div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Reviewed {r.reviewedN} of {r.total} trades ({fmt(r.coverage)}%). Open a trade, watch your video, and tag the
        direction call, entry timing, market movement and what drove it. Reviewing a past trade that isn't in a CSV?
        Use <b>＋ Add trade to review</b>.
      </div>

      {/* Film strip — the active account's clips. Hidden when THIS account has
          none but the Library below has clips, so we never show a "no clips"
          panel sitting above clips that are clearly visible. */}
      {(r.filmRoom.length > 0 || lib.length === 0) && (
      <div className="panel">
        <h2>Film strip</h2>
        {r.filmRoom.length === 0 ? (
          <div className="muted">No clips or screenshots attached yet. Open a trade and add a Film Room clip, or your entry + "what happened later" shots.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {r.filmRoom.map((t) => (
              <div key={t.id} className="film-row" onClick={() => openTrade(t.id)}>
                <button className="film-del" title="Remove this clip"
                  onClick={(e) => { e.stopPropagation(); delClip(t.id); }}>✕</button>
                <div className="film-shots">
                  {t.video && (
                    <figure className="film-shot film-clip" onClick={(e) => e.stopPropagation()}>
                      <video src={`/api/videos/${t.video}`} controls preload="metadata" />
                      <button className="clip-expand" title="Theater mode — watch bigger"
                        onClick={(e) => { e.stopPropagation(); setTheater(t.video); }}>⛶</button>
                      <figcaption>Clip</figcaption>
                    </figure>
                  )}
                  {t.screenshots.map((name, i) => (
                    <figure key={name} className="film-shot">
                      <img src={`/api/screenshots/${name}`} alt="" />
                      <figcaption>{i === 0 ? 'Entry' : 'Later'}</figcaption>
                    </figure>
                  ))}
                </div>
                <div className="film-meta">
                  <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                    <b>{t.contract}</b><span className="muted">{t.direction} × {t.qty}</span>
                    <span className={t.pnl >= 0 ? 'pos' : 'neg'}>{money(t.pnl)}</span>
                  </div>
                  <FilmDetails t={t} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Library — clips from archived accounts, so they stay watchable */}
      {lib.length > 0 && (
        <div className="panel">
          <h2>Library — clips from archived accounts</h2>
          <div className="muted" style={{ fontSize: 13, margin: '-4px 0 12px' }}>
            Clips from accounts you've archived live here so they're never lost. Un-archive an account to move its clips back to its own strip.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {lib.map((t) => (
              <div key={t.id} className="film-row" onClick={() => setSelected(t)}>
                <button className="film-del" title="Remove this clip"
                  onClick={(e) => { e.stopPropagation(); delClip(t.id); }}>✕</button>
                <div className="film-shots">
                  <figure className="film-shot film-clip" onClick={(e) => e.stopPropagation()}>
                    <video src={`/api/videos/${t.video}`} controls preload="metadata" />
                    <button className="clip-expand" title="Theater mode — watch bigger"
                      onClick={(e) => { e.stopPropagation(); setTheater(t.video); }}>⛶</button>
                    <figcaption>Clip</figcaption>
                  </figure>
                </div>
                <div className="film-meta">
                  <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                    <b>{t.contract}</b><span className="muted">{t.direction} × {t.qty}</span>
                    <span className={t.pnl >= 0 ? 'pos' : 'neg'}>{money(t.pnl)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    <span className="tag">{t.account}</span>
                    {t.exit_time ? ` ${t.exit_time.slice(0, 10)}` : ''}
                    {t.archived_at ? ` · archived ${t.archived_at.slice(0, 10)}` : ''}
                  </div>
                  <FilmDetails t={t} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review analytics — folded by default; the numbers, not the tape */}
      <details className="review-analytics">
        <summary>Review analytics — direction, movement, intuition &amp; timing</summary>
      {r.reviewedN === 0 ? (
        <div className="panel muted">
          Nothing reviewed yet. Go to <b>Trades</b> (or click a card below), open a trade, drop in your entry and
          "what happened later" screenshots, and fill the <b>🎬 Film Room</b> section. Then come back here.
        </div>
      ) : (
        <>
          {/* Q1 — right direction, entered too early */}
          <div className="panel" style={{ marginBottom: 14 }}>
            <h2>1 · Right direction, entered too early</h2>
            <div className="row" style={{ gap: 28, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <div><div className="big">{e.n}</div><div className="muted">early-but-right trades</div></div>
              <div><div className="big">{e.rightDirN ? `${fmt(e.shareOfRight)}%` : '—'}</div><div className="muted">of your correct calls were early</div></div>
              <div><div className={`big ${e.pnl >= 0 ? 'pos' : 'neg'}`}>{money(e.pnl)}</div><div className="muted">P&L on those trades</div></div>
              <div><div className="big">{e.withMfeN ? fmt(e.pointsLeftOnTable) : '—'}</div><div className="muted">points left on the table{e.withMfeN ? ` (${e.withMfeN} trades)` : ''}</div></div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {e.n === 0
                ? 'No trades tagged "right direction" + "too early" yet.'
                : 'These are trades where your read was correct but you jumped in before the move — the fix is a later/confirmed entry, not a different direction.'}
            </div>
          </div>

          {/* Q2 — which movement makes the most money */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
            <div className="panel">
              <h2>2 · Which movement pays</h2>
              {r.byMove.length === 0 ? <div className="muted">Tag the market movement on your trades to see this.</div> : (
                <table>
                  <thead><tr><th>Movement</th><th>Trades</th><th>Win%</th><th>Avg</th><th>P&L</th></tr></thead>
                  <tbody>
                    {r.byMove.map((m) => (
                      <tr key={m.key}>
                        <td>{MOVE_LABEL[m.key] || m.key}</td><td>{m.n}</td>
                        <td>{m.winRate == null ? '—' : `${fmt(m.winRate)}%`}</td>
                        <td className={m.avgPnl >= 0 ? 'pos' : 'neg'}>{money(m.avgPnl)}</td>
                        <PnlCell v={m.pnl} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="panel">
              <h2>P&L by movement</h2>
              {r.byMove.length === 0 ? <div className="muted">—</div> : <MoveBars data={r.byMove} />}
            </div>
          </div>

          {/* Q3 — where intuition fails */}
          <div className="panel" style={{ marginBottom: 14 }}>
            <h2>3 · Where your intuition fails</h2>
            <table style={{ maxWidth: 560, marginBottom: 10 }}>
              <thead><tr><th></th><th>Trades</th><th>Win%</th><th>Avg</th><th>P&L</th></tr></thead>
              <tbody>
                <tr><td>Gut-feel trades</td><td>{gut.n}</td><td>{gut.winRate == null ? '—' : `${fmt(gut.winRate)}%`}</td><td className={gut.avgPnl >= 0 ? 'pos' : 'neg'}>{money(gut.avgPnl)}</td><PnlCell v={gut.pnl} /></tr>
                <tr><td>Followed-the-plan trades</td><td>{plan.n}</td><td>{plan.winRate == null ? '—' : `${fmt(plan.winRate)}%`}</td><td className={plan.avgPnl >= 0 ? 'pos' : 'neg'}>{money(plan.avgPnl)}</td><PnlCell v={plan.pnl} /></tr>
              </tbody>
            </table>
            {gut.n > 0 && plan.n > 0 && (
              <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                {gut.avgPnl < plan.avgPnl
                  ? `Your gut underperforms your plan by ${money(plan.avgPnl - gut.avgPnl)}/trade — intuition is costing you here.`
                  : `Your gut is actually beating your plan by ${money(gut.avgPnl - plan.avgPnl)}/trade — worth trusting, with discipline.`}
              </div>
            )}
            {r.intuition.gutByMove.length > 0 && (
              <>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Gut trades by market movement — where the gut reads right vs wrong:</div>
                <table style={{ maxWidth: 480 }}>
                  <thead><tr><th>Movement</th><th>Trades</th><th>Win%</th><th>P&L</th></tr></thead>
                  <tbody>
                    {r.intuition.gutByMove.map((m) => (
                      <tr key={m.key}><td>{MOVE_LABEL[m.key] || m.key}</td><td>{m.n}</td><td>{m.winRate == null ? '—' : `${fmt(m.winRate)}%`}</td><PnlCell v={m.pnl} /></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* Entry-timing distribution */}
          <div className="panel" style={{ marginBottom: 14 }}>
            <h2>Entry timing breakdown</h2>
            {r.byTiming.length === 0 ? <div className="muted">Tag entry timing on your trades to see this.</div> : (
              <table style={{ maxWidth: 520 }}>
                <thead><tr><th>Timing</th><th>Trades</th><th>Win%</th><th>Avg</th><th>P&L</th></tr></thead>
                <tbody>
                  {r.byTiming.map((m) => (
                    <tr key={m.key}>
                      <td>{TIMING_LABEL[m.key] || m.key}</td><td>{m.n}</td>
                      <td>{m.winRate == null ? '—' : `${fmt(m.winRate)}%`}</td>
                      <td className={m.avgPnl >= 0 ? 'pos' : 'neg'}>{money(m.avgPnl)}</td>
                      <PnlCell v={m.pnl} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      </details>

      {selected && (
        <TradePanel trade={selected} onClose={() => setSelected(null)} onSaved={() => setV((x) => x + 1)} />
      )}
      {adding && (
        <AddTradeModal
          onClose={() => setAdding(false)}
          onCreated={(t) => { setAdding(false); setV((x) => x + 1); setSelected(t); }}
        />
      )}
      {theater && (
        <div className="theater-overlay" onClick={() => setTheater(null)}>
          <button className="theater-close" onClick={() => setTheater(null)} title="Close">✕</button>
          <video className="theater-video" src={`/api/videos/${theater}`} controls autoPlay
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
