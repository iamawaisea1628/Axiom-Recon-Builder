import React, { useState } from 'react';
import {
  OverviewIcon, WorkspacesIcon, ReconcileIcon, ExceptionsIcon, HistoryIcon, RulesIcon, SettingsIcon,
} from './Icons';
import '../styles/Sidebar.css';

const ITEMS = [
  { id: 'dashboard', label: 'Overview', Icon: OverviewIcon },
  { id: 'workspaces', label: 'Workspaces', Icon: WorkspacesIcon },
  { id: 'reconciliation', label: 'Reconciliations', Icon: ReconcileIcon },
  { id: 'exceptions', label: 'Exceptions', Icon: ExceptionsIcon },
  { id: 'history', label: 'History', Icon: HistoryIcon },
  { id: 'rules', label: 'Rules', Icon: RulesIcon },
];
const SETTINGS = { id: 'settings', label: 'Settings', Icon: SettingsIcon };

export default function Sidebar({ currentPage, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const active = currentPage === 'results' ? 'reconciliation' : currentPage;
  const item = ({ id, label, Icon }) => (
    <button
      key={id}
      type="button"
      className={active === id ? 'active' : ''}
      aria-current={active === id ? 'page' : undefined}
      title={label}
      onClick={() => onNavigate(id)}
    >
      <Icon />
      <span className="nav-label">{label}</span>
    </button>
  );
  return (
    <nav
      className={`sidebar${expanded ? ' expanded' : ''}`}
      aria-label="Main navigation"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      <div className="sidebar-main">{ITEMS.map(item)}</div>
      <div className="sidebar-foot">{item(SETTINGS)}</div>
    </nav>
  );
}
