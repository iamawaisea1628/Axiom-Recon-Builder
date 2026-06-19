import React, { useState, useEffect } from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ReconciliationTool from './pages/ReconciliationTool';
import Settings from './pages/Settings';
import History from './pages/History.jsx';
import Rules from './pages/Rules.jsx';
import Sidebar from './components/Sidebar';
import UserProfile from './components/UserProfile';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('reconciliation');

  useEffect(() => {
    // Check if user is already logged in
    const savedToken = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('user');
    
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch (err) {
        console.error('Error loading saved user:', err);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
      }
    }
    
    setLoading(false);
  }, []);

  const handleLoginSuccess = ({ token, user }) => {
    setToken(token);
    setUser(user);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setCurrentPage('reconciliation');
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
  };

  const handleNavigate = (pageId) => {
    setCurrentPage(pageId);
  };

  const getPageTitle = () => {
    switch(currentPage) {
      case 'dashboard':
        return '📊 Dashboard';
      case 'reconciliation':
        return '🔄 Reconciliation';
      case 'history':
        return '📜 History';
      case 'rules':
        return '🎯 Rules Engine';
      case 'settings':
        return '⚙️ Settings';
      default:
        return '📊 Axiom Recon Builder';
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '18px',
        background: 'linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)'
      }}>
        Loading...
      </div>
    );
  }

  // Show Login page if not authenticated
  if (!token || !user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Show App with Sidebar if authenticated
  return (
    <div className="App">
      {/* Header - Always visible, not affected by sidebar */}
      <div className="app-header">
        <div className="header-brand">📊 Axiom Recon Builder</div>
        <div className="header-divider" />
        <h1>{getPageTitle()}</h1>
        
        {/* User Profile - Right side */}
        <div className="header-spacer" />
        <UserProfile 
          user={user}
          onLogout={handleLogout}
          onNavigateToSettings={() => handleNavigate('settings')}
        />
      </div>

      {/* Main Content Area */}
      <div className="app-main">
        {/* Floating Sidebar */}
        <Sidebar 
          user={user} 
          currentPage={currentPage}
          onNavigate={handleNavigate}
        />

        {/* Content Area - Full width, not affected by sidebar */}
        <div className="app-content">
          {currentPage === 'dashboard' && (
            <Dashboard token={token} user={user} />
          )}

          {currentPage === 'reconciliation' && (
            <ReconciliationTool token={token} user={user} />
          )}
          
          {currentPage === 'history' && (
            <History token={token} user={user} />
          )}
          
          {currentPage === 'rules' && (
            <Rules token={token} user={user} />
          )}
          
          {currentPage === 'settings' && (
            <Settings token={token} user={user} />
          )}
        </div>
      </div>
      <SpeedInsights />
    </div>
  );
}

export default App;
