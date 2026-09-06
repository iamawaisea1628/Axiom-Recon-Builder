import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import '../styles/Settings.css';

export default function Settings({ user, onUserUpdated }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Profile Settings
  const [profileData, setProfileData] = useState({
    name: user?.name || '',
    email: user?.email || '',
  });

  // Password Settings
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Preferences
  const preferenceKey = `axiom-preferences:${user?.id || 'anonymous'}`;
  const [preferences, setPreferences] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(preferenceKey)) || {
        theme: localStorage.getItem('app-theme') || 'light',
        emailNotifications: true,
        matchAlerts: true,
        weeklyReport: false,
      };
    } catch {
      return { theme: 'light', emailNotifications: true, matchAlerts: true, weeklyReport: false };
    }
  });

  // Apply theme on component mount and when theme preference changes
  useEffect(() => {
    applyTheme(preferences.theme);
  }, [preferences.theme]);

  const applyTheme = (theme) => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.style.setProperty('--bg-primary', '#111827');
      root.style.setProperty('--bg-secondary', '#1F2937');
      root.style.setProperty('--text-primary', '#F9FAFB');
      root.style.setProperty('--text-secondary', '#D1D5DB');
      root.style.setProperty('--border-color', '#374151');
      document.body.style.backgroundColor = '#111827';
      document.body.style.color = '#F9FAFB';
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      root.style.setProperty('--bg-primary', '#F9FAFB');
      root.style.setProperty('--bg-secondary', '#FFFFFF');
      root.style.setProperty('--text-primary', '#1F2937');
      root.style.setProperty('--text-secondary', '#6B7280');
      root.style.setProperty('--border-color', '#E5E7EB');
      document.body.style.backgroundColor = '#F9FAFB';
      document.body.style.color = '#1F2937';
      document.documentElement.removeAttribute('data-theme');
    }
  };

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({ ...prev, [name]: value }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
  };

  const handlePreferenceChange = (e) => {
    const { name, type, checked, value } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    
    setPreferences(prev => ({
      ...prev,
      [name]: newValue
    }));

    // Apply theme immediately if it's the theme select
    if (name === 'theme') {
      localStorage.setItem('app-theme', value);
      applyTheme(value);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const name = profileData.name.trim();
      if (name.length < 2) throw new Error('Enter your full name.');
      const { data, error } = await supabase.auth.updateUser({ data: { full_name: name } });
      if (error) throw error;
      onUserUpdated?.(data.user);
      setMessage({ type: 'success', text: 'Profile updated successfully.' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Error: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' });
      setLoading(false);
      return;
    }

    if (passwordData.newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      setLoading(false);
      return;
    }

    try {
      if (!/[A-Z]/.test(passwordData.newPassword) || !/\d/.test(passwordData.newPassword)) {
        throw new Error('Password must contain an uppercase letter and a number.');
      }
      const { error } = await supabase.auth.updateUser({
        email: user.email,
        current_password: passwordData.oldPassword,
        password: passwordData.newPassword,
      });
      if (error) throw error;
      setMessage({ type: 'success', text: 'Password changed successfully.' });
      setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Error: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePreferences = (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    localStorage.setItem('app-theme', preferences.theme);
    setMessage({ type: 'success', text: 'Preferences saved for this browser.' });
    setLoading(false);
  };

  return (
    <div className="settings-container">
      {/* Tabs */}
      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          👤 Profile
        </button>
        <button
          className={`settings-tab ${activeTab === 'password' ? 'active' : ''}`}
          onClick={() => setActiveTab('password')}
        >
          🔐 Security
        </button>
        <button
          className={`settings-tab ${activeTab === 'preferences' ? 'active' : ''}`}
          onClick={() => setActiveTab('preferences')}
        >
          ⚙️ Preferences
        </button>
      </div>

      {/* Messages */}
      {message.text && (
        <div className={`settings-message ${message.type}`}>
          {message.type === 'success' ? '✅' : '⚠️'} {message.text}
        </div>
      )}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="settings-section">
          <div className="section-header">
            <h2>👤 Profile Settings</h2>
            <p>Manage your account information</p>
          </div>

          <form onSubmit={handleSaveProfile} className="settings-form">
            <div className="form-group">
              <label htmlFor="name">Full Name</label>
              <input
                id="name"
                type="text"
                name="name"
                value={profileData.name}
                onChange={handleProfileChange}
                placeholder="Your full name"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                name="email"
                value={profileData.email}
                disabled
                placeholder="Your email"
                className="form-input disabled"
              />
              <small>Email cannot be changed</small>
            </div>

            <div className="form-group">
              <label htmlFor="role">Role</label>
              <input
                id="role"
                type="text"
                value={user?.role || 'User'}
                disabled
                className="form-input disabled"
              />
            </div>

            <div className="form-actions">
              <button type="submit" disabled={loading} className="btn btn-primary">
                {loading ? 'Saving...' : '💾 Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Password Tab */}
      {activeTab === 'password' && (
        <div className="settings-section">
          <div className="section-header">
            <h2>🔐 Security Settings</h2>
            <p>Manage your password and security</p>
          </div>

          <form onSubmit={handleChangePassword} className="settings-form">
            <div className="security-warning">
              <span>🔒</span>
              <p>Keep your password strong and unique. Never share it with anyone.</p>
            </div>

            <div className="form-group">
              <label htmlFor="oldPassword">Current Password</label>
              <input
                id="oldPassword"
                type="password"
                name="oldPassword"
                value={passwordData.oldPassword}
                onChange={handlePasswordChange}
                placeholder="Enter current password"
                className="form-input"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                type="password"
                name="newPassword"
                value={passwordData.newPassword}
                onChange={handlePasswordChange}
                placeholder="Enter new password"
                className="form-input"
                required
              />
              <small>Minimum 8 characters, 1 uppercase, 1 number</small>
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm New Password</label>
              <input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                value={passwordData.confirmPassword}
                onChange={handlePasswordChange}
                placeholder="Confirm new password"
                className="form-input"
                required
              />
            </div>

            <div className="form-actions">
              <button type="submit" disabled={loading} className="btn btn-primary">
                {loading ? 'Updating...' : '🔄 Change Password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Preferences Tab */}
      {activeTab === 'preferences' && (
        <div className="settings-section">
          <div className="section-header">
            <h2>⚙️ Preferences</h2>
            <p>Customize your experience</p>
          </div>

          <form onSubmit={handleSavePreferences} className="settings-form">
            <div className="preferences-group">
              <h3>🎨 Theme & Display</h3>
              
              <div className="form-group">
                <label htmlFor="theme">Theme</label>
                <select
                  id="theme"
                  name="theme"
                  value={preferences.theme}
                  onChange={handlePreferenceChange}
                  className="form-input"
                >
                  <option value="light">☀️ Light Mode</option>
                  <option value="dark">🌙 Dark Mode</option>
                </select>
                <small>Theme changes apply immediately</small>
              </div>
            </div>

            <div className="preferences-group">
              <h3>🔔 Notifications</h3>
              
              <div className="form-group checkbox">
                <input
                  id="emailNotifications"
                  type="checkbox"
                  name="emailNotifications"
                  checked={preferences.emailNotifications}
                  onChange={handlePreferenceChange}
                />
                <label htmlFor="emailNotifications">
                  📧 Email Notifications
                  <small>Receive email updates about your account</small>
                </label>
              </div>

              <div className="form-group checkbox">
                <input
                  id="matchAlerts"
                  type="checkbox"
                  name="matchAlerts"
                  checked={preferences.matchAlerts}
                  onChange={handlePreferenceChange}
                />
                <label htmlFor="matchAlerts">
                  ⚡ Match Alerts
                  <small>Get notified when reconciliations complete</small>
                </label>
              </div>

              <div className="form-group checkbox">
                <input
                  id="weeklyReport"
                  type="checkbox"
                  name="weeklyReport"
                  checked={preferences.weeklyReport}
                  onChange={handlePreferenceChange}
                />
                <label htmlFor="weeklyReport">
                  📊 Weekly Report
                  <small>Receive weekly reconciliation reports</small>
                </label>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" disabled={loading} className="btn btn-primary">
                {loading ? 'Saving...' : '💾 Save Preferences'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
