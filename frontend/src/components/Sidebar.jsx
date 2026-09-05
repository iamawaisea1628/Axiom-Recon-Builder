import React, { useState } from 'react';
import { useTheme } from '../context/ThemeProvider';
 
export default function Sidebar({ user, currentPage, onNavigate }) {
  const { isDark, toggleTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
 
  const menuItems = [
    { id: 'dashboard', label: 'Overview', icon: 'OV' },
    { id: 'workspaces', label: 'Workspaces', icon: 'WS' },
    { id: 'reconciliation', label: 'Reconciliations', icon: 'RC' },
    { id: 'history', label: 'History', icon: 'HI' },
    { id: 'rules', label: 'Rules', icon: 'RU' },
    { id: 'settings', label: 'Settings', icon: 'ST' },
  ];
 
  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={`fixed left-0 top-0 h-screen transition-all duration-300 ease-out z-30 ${
        expanded ? 'w-64' : 'w-20'
      } ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} border-r backdrop-blur-md`}
    >
      {/* Brand */}
      <div className={`flex items-center justify-center h-20 ${isDark ? 'border-slate-800' : 'border-slate-200'} border-b`}>
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
          <span className="text-white font-bold text-xl">A</span>
        </div>
        {expanded && (
          <div className="ml-3">
            <div className="font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
              Axiom
            </div>
            <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Recon
            </div>
          </div>
        )}
      </div>
 
      {/* Menu Items */}
      <div className="p-4 space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 ${
              currentPage === item.id
                ? `bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/50`
                : `${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`
            }`}
            title={item.label}
          >
            <span className="nav-monogram">{item.icon}</span>
            {expanded && <span className="font-semibold">{item.label}</span>}
          </button>
        ))}
      </div>
 
      {/* Bottom Actions */}
      <div className={`absolute bottom-0 left-0 right-0 p-4 space-y-2 ${isDark ? 'border-slate-800' : 'border-slate-200'} border-t`}>
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-300 ${
            isDark
              ? 'text-slate-400 hover:text-white hover:bg-slate-800'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
          title={isDark ? 'Light Mode' : 'Dark Mode'}
        >
          <span className="text-xl">{isDark ? '☀️' : '🌙'}</span>
          {expanded && <span className="font-semibold">{isDark ? 'Light' : 'Dark'}</span>}
        </button>
      </div>
    </div>
  );
}
 
