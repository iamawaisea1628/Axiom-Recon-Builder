import React from 'react';

// Line icons drawn for this app (24px grid, 1.6 stroke, inherit currentColor).
const Svg = ({ children, size = 22, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>{children}</svg>
);

export const OverviewIcon = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7.5" height="9" rx="1.5" />
    <rect x="13" y="3.5" width="7.5" height="5.5" rx="1.5" />
    <rect x="13" y="11.5" width="7.5" height="9" rx="1.5" />
    <rect x="3.5" y="15" width="7.5" height="5.5" rx="1.5" />
  </Svg>
);

export const WorkspacesIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" />
    <path d="M3.5 12 12 16.5 20.5 12" />
    <path d="M3.5 16 12 20.5 20.5 16" />
  </Svg>
);

export const ReconcileIcon = (p) => (
  <Svg {...p}>
    <path d="M4 8h14" />
    <path d="M14.5 4.5 18 8l-3.5 3.5" />
    <path d="M20 16H6" />
    <path d="M9.5 12.5 6 16l3.5 3.5" />
  </Svg>
);

export const ExceptionsIcon = (p) => (
  <Svg {...p}>
    <path d="M12 4 3 19.5h18z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.4v.1" />
  </Svg>
);

export const HistoryIcon = (p) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 4.5v4h4" />
    <path d="M12 8v4.2l2.8 1.8" />
  </Svg>
);

export const RulesIcon = (p) => (
  <Svg {...p}>
    <path d="M4 7h9" />
    <path d="M17 7h3" />
    <circle cx="15" cy="7" r="2" />
    <path d="M4 17h3" />
    <path d="M11 17h9" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);

export const SettingsIcon = (p) => (
  <Svg {...p}>
    <path d="M18.7 9.9 L21.3 10.4 L21.3 13.6 L18.7 14.1 L18.2 15.3 L19.7 17.4 L17.4 19.7 L15.3 18.2 L14.1 18.7 L13.6 21.3 L10.4 21.3 L9.9 18.7 L8.7 18.2 L6.6 19.7 L4.3 17.4 L5.8 15.3 L5.3 14.1 L2.7 13.6 L2.7 10.4 L5.3 9.9 L5.8 8.7 L4.3 6.6 L6.6 4.3 L8.7 5.8 L9.9 5.3 L10.4 2.7 L13.6 2.7 L14.1 5.3 L15.3 5.8 L17.4 4.3 L19.7 6.6 L18.2 8.7Z" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
);

// Ledger page with one highlighted entry: the brand mark.
export const BrandMark = ({ size = 30 }) => (
  <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" focusable="false" className="brand-mark">
    <rect width="30" height="30" rx="7" fill="#1f4d3e" />
    <rect x="7" y="8" width="16" height="2.2" rx="1.1" fill="#fff" opacity=".9" />
    <rect x="6" y="13" width="18" height="4.4" rx="1.4" fill="#d6b66b" />
    <rect x="7" y="20.4" width="11" height="2.2" rx="1.1" fill="#fff" opacity=".9" />
  </svg>
);
