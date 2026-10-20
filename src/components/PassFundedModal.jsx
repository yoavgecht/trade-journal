import React, { useState } from 'react';
import { fundedNameDefault, fundedPrefix } from '../presets.js';

// Naming the new funded account after passing an eval. Firms with a fixed id
// prefix (Apex "PAAPEX<number>", Lucid "LFF<number>") show that prefix LOCKED
// (not editable) and the user only types the number the firm assigned. Other
// firms get a normal editable name.
export default function PassFundedModal({ firm, evalName, onConfirm, onCancel }) {
  const prefix = fundedPrefix(firm);                                      // 'PAAPEX' | 'LFF' | null
  const [suffix, setSuffix] = useState('');                               // number after the prefix
  const [name, setName] = useState(() => fundedNameDefault(firm, evalName)); // no-prefix firms: editable

  const finalName = prefix ? `${prefix}${suffix.trim()}` : name.trim();
  const canCreate = prefix ? suffix.trim().length > 0 : name.trim().length > 0;
  const submit = () => { if (canCreate) onConfirm(finalName); };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={onCancel}>✕</button>
        <h3>🎉 Passed! Name your funded account</h3>
        <div className="muted" style={{ fontSize: 13, margin: '-6px 0 14px' }}>
          Size + payout rules are set from the funded plan.
        </div>

        {prefix ? (
          <div className="field">
            <label>{firm} account</label>
            <div className="prefix-input">
              <span className="prefix">{prefix}</span>
              <input autoFocus inputMode="numeric" value={suffix} placeholder="Sim funded number"
                onChange={(e) => setSuffix(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Account name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button disabled={!canCreate} onClick={submit}>Create funded account</button>
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
