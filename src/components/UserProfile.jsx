import React, { useState } from 'react';
import '../styles/UserProfile.css';

export default function UserProfile({ user, onLogout, onNavigateToSettings }) {
  const [isOpen, setIsOpen] = useState(false);

  const getInitials = () => {
    if (user?.name) {
      return user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase();
    }
    return user?.email?.charAt(0).toUpperCase() || 'U';
  };

  return (
    <div className="user-profile-container">
      <button
        className="user-profile-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Profile menu"
      >
        <div className="profile-avatar">{getInitials()}</div>
        <div className="profile-info">
          <div className="profile-name">{user?.name || user?.email}</div>
          <div className="profile-role">User</div>
        </div>
        <svg
          className={`profile-chevron ${isOpen ? 'open' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="profile-dropdown">
          <button className="dropdown-item logout-item" onClick={onLogout}>
            <span>🚪</span> Logout
          </button>
        </div>
      )}
    </div>
  );
}
