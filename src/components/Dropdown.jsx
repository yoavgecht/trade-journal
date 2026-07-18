import React, { useEffect, useState } from 'react';

// Custom dropdown — native <select> options can't be padded/spaced, so this
// renders a styled menu with roomy, hoverable rows. Click-outside / Esc closes.
export default function Dropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const sel = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="dd">
      <button type="button" className="dd-btn" onClick={() => setOpen((o) => !o)}>
        <span>{sel ? sel.label : 'Select…'}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="dd-backdrop" onClick={() => setOpen(false)} />
          <div className="dd-menu">
            {options.map((o) => (
              <button type="button" key={o.value} className={`dd-item ${o.value === value ? 'on' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span className="dd-check">{o.value === value ? '✓' : ''}</span>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
