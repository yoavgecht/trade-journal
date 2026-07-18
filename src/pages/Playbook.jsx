import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// A global study library of chart screenshots, grouped by what they show.
export const CATEGORIES = ['Setup', 'Trap', 'Mistake', 'A+ Trade', 'Lesson'];

export default function Playbook() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('All');
  const [cat, setCat] = useState('Setup');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null); // { file, url }
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lb, setLb] = useState(null); // lightbox: index into `shown`, or null
  const fileRef = useRef();

  const load = () => api('/library').then(setItems);
  useEffect(() => { load(); }, []);

  const choose = (f) => { if (f && f.type.startsWith('image/')) setFile({ file: f, url: URL.createObjectURL(f) }); };

  // Paste a screenshot straight in (⌘V) while on the page.
  useEffect(() => {
    const onPaste = (e) => {
      const img = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (img) { const f = img.getAsFile(); if (f) { e.preventDefault(); choose(f); } }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const add = async () => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file.file);
    fd.append('category', cat);
    fd.append('title', title);
    fd.append('note', note);
    await api('/library', { method: 'POST', body: fd });
    setBusy(false);
    setFile(null); setTitle(''); setNote('');
    load();
  };

  const del = async (id) => {
    if (!confirm('Delete this screenshot from the playbook?')) return;
    await api(`/library/${id}`, { method: 'DELETE' });
    load();
  };

  const shown = filter === 'All' ? items : items.filter((i) => i.category === filter);
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length]));

  // Lightbox keyboard nav: Esc closes, ←/→ move between screenshots.
  useEffect(() => {
    if (lb === null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLb(null);
      else if (e.key === 'ArrowRight') setLb((v) => (v + 1) % shown.length);
      else if (e.key === 'ArrowLeft') setLb((v) => (v - 1 + shown.length) % shown.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb, shown.length]);

  return (
    <>
      <h1>📚 Playbook</h1>
      <div className="muted" style={{ marginBottom: 14 }}>
        Build a library of chart screenshots — setups to take, traps to avoid, mistakes to remember. Drag in, paste (⌘V), or click.
      </div>

      {/* Add */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="field-row" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div
            className={`dropzone ${dragOver ? 'over' : ''}`}
            style={{ flex: '0 0 260px', minHeight: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, overflow: 'hidden' }}
            onClick={() => fileRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); choose(e.dataTransfer.files[0]); }}
          >
            {file
              ? <img src={file.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : (dragOver ? 'Drop it' : 'Drop / paste / click to add a screenshot')}
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { choose(e.target.files[0]); e.target.value = ''; }} />
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="field">
              <label>Category</label>
              <div>
                {CATEGORIES.map((c) => (
                  <span key={c} className={`tag ${cat === c ? 'sel' : ''}`} onClick={() => setCat(c)}>{c}</span>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Failed breakout above ORH" />
            </div>
            <div className="field">
              <label>Note</label>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="What to look for / what it taught you" />
            </div>
            <button disabled={busy || !file} onClick={add}>{busy ? 'Saving…' : 'Add to playbook'}</button>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {['All', ...CATEGORIES].map((c) => (
          <span key={c} className={`tag ${filter === c ? 'sel' : ''}`} onClick={() => setFilter(c)}>
            {c}{c !== 'All' && counts[c] ? ` (${counts[c]})` : ''}{c === 'All' ? ` (${items.length})` : ''}
          </span>
        ))}
      </div>

      {/* Gallery */}
      {shown.length === 0 ? (
        <div className="panel muted">{items.length === 0 ? 'Nothing here yet — add your first screenshot above.' : 'Nothing in this category.'}</div>
      ) : (
        <div className="lib-grid">
          {shown.map((it, i) => (
            <div key={it.id} className="lib-card">
              <img src={`/api/screenshots/${it.filename}`} alt={it.title || ''}
                onClick={() => setLb(i)} />
              <button className="lib-del" onClick={() => del(it.id)} title="Delete">✕</button>
              <div className="lib-body">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                  <b style={{ fontSize: 13 }}>{it.title || '—'}</b>
                  {it.category && <span className="tag sel" style={{ cursor: 'default' }}>{it.category}</span>}
                </div>
                {it.note && <div className="muted" style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{it.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox — big, clear view */}
      {lb !== null && shown[lb] && (
        <div className="lb-overlay" onClick={() => setLb(null)}>
          <button className="lb-close" onClick={() => setLb(null)} title="Close (Esc)">✕</button>
          {shown.length > 1 && (
            <button className="lb-nav lb-prev" title="Previous (←)"
              onClick={(e) => { e.stopPropagation(); setLb((lb - 1 + shown.length) % shown.length); }}>‹</button>
          )}
          <img className="lb-img" src={`/api/screenshots/${shown[lb].filename}`} alt={shown[lb].title || ''}
            onClick={(e) => e.stopPropagation()} />
          {shown.length > 1 && (
            <button className="lb-nav lb-next" title="Next (→)"
              onClick={(e) => { e.stopPropagation(); setLb((lb + 1) % shown.length); }}>›</button>
          )}
          {(shown[lb].title || shown[lb].note || shown[lb].category) && (
            <div className="lb-cap" onClick={(e) => e.stopPropagation()}>
              {shown[lb].category && <span className="tag sel" style={{ cursor: 'default' }}>{shown[lb].category}</span>}
              {shown[lb].title && <b style={{ marginLeft: 8 }}>{shown[lb].title}</b>}
              {shown[lb].note && <div className="muted" style={{ fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>{shown[lb].note}</div>}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{lb + 1} / {shown.length}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
