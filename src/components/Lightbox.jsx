import React, { useEffect, useState } from 'react';

// Full-screen image viewer (same look as the Playbook lightbox). Pass a single
// url or an array; ←/→ page through, Esc/click-outside closes.
export default function Lightbox({ images, start = 0, onClose }) {
  const list = Array.isArray(images) ? images : [images];
  const [i, setI] = useState(start);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((v) => (v + 1) % list.length);
      else if (e.key === 'ArrowLeft') setI((v) => (v - 1 + list.length) % list.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list.length, onClose]);

  if (!list.length) return null;
  return (
    <div className="lb-overlay" onClick={onClose}>
      <button className="lb-close" onClick={onClose} title="Close (Esc)">✕</button>
      {list.length > 1 && (
        <button className="lb-nav lb-prev" title="Previous (←)"
          onClick={(e) => { e.stopPropagation(); setI((i - 1 + list.length) % list.length); }}>‹</button>
      )}
      <img className="lb-img" src={list[i]} alt="" onClick={(e) => e.stopPropagation()} />
      {list.length > 1 && (
        <button className="lb-nav lb-next" title="Next (→)"
          onClick={(e) => { e.stopPropagation(); setI((i + 1) % list.length); }}>›</button>
      )}
      {list.length > 1 && (
        <div className="lb-cap" onClick={(e) => e.stopPropagation()}>
          <div className="muted" style={{ fontSize: 12 }}>{i + 1} / {list.length}</div>
        </div>
      )}
    </div>
  );
}
