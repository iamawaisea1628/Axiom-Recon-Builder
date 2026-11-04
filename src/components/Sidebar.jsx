import React, { useState } from 'react';
import '../styles/Sidebar.css';

const ITEMS = [
  { id: 'dashboard', label: 'Overview', icon: 'OV' },
  { id: 'workspaces', label: 'Workspaces', icon: 'WS' },
  { id: 'reconciliation', label: 'Reconciliations', icon: 'RC' },
  { id: 'exceptions', label: 'Exceptions', icon: 'EX' },
  { id: 'history', label: 'History', icon: 'HI' },
  { id: 'rules', label: 'Rules', icon: 'RU' },
  { id: 'settings', label: 'Settings', icon: 'ST' },
];

export default function Sidebar({ currentPage, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const active = currentPage === 'results' ? 'reconciliation' : currentPage;
  return (
    <nav
      className={`sidebar${expanded ? ' expanded' : ''}`}
      aria-label="Main navigation"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={active === item.id ? 'active' : ''}
          aria-current={active === item.id ? 'page' : undefined}
          title={item.label}
          onClick={() => onNavigate(item.id)}
        >
          <span className="nav-monogram">{item.icon}</span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
