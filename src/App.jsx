import React, { useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import Overview from './pages/Overview.jsx';
import Patterns from './pages/Patterns.jsx';
import Risk from './pages/Risk.jsx';
import Trades from './pages/Trades.jsx';
import Settings from './pages/Settings.jsx';
import { api } from './api.js';

export default function App() {
  // Bumped after every import so pages refetch.
  const [dataVersion, setDataVersion] = useState(0);
  const navigate = useNavigate();

  const importFiles = async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const { results } = await api('/import', { method: 'POST', body: fd });
    setDataVersion((v) => v + 1);
    return results;
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">📈 Trade Journal</div>
        <NavLink className="nav-link" to="/" end>Overview</NavLink>
        <NavLink className="nav-link" to="/patterns">Patterns</NavLink>
        <NavLink className="nav-link" to="/risk">Risk</NavLink>
        <NavLink className="nav-link" to="/trades">Trades</NavLink>
        <NavLink className="nav-link" to="/settings">Settings</NavLink>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview dataVersion={dataVersion} onImport={importFiles} />} />
          <Route path="/patterns" element={<Patterns dataVersion={dataVersion} />} />
          <Route path="/risk" element={<Risk dataVersion={dataVersion} />} />
          <Route path="/trades" element={<Trades dataVersion={dataVersion} />} />
          <Route path="/settings" element={<Settings onChanged={() => setDataVersion((v) => v + 1)} />} />
        </Routes>
      </main>
    </div>
  );
}
