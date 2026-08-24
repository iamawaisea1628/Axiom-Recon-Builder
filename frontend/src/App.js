import React, { useState, useEffect } from 'react';
import LandingPage from './pages/LandingPage';
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
  const [user,setUser]=useState(null); const [token,setToken]=useState(null); const [loading,setLoading]=useState(true);
  const [currentPage,setCurrentPage]=useState('reconciliation'); const [publicView,setPublicView]=useState('landing');
  useEffect(()=>{const savedToken=localStorage.getItem('auth_token');const savedUser=localStorage.getItem('user');if(savedToken&&savedUser){try{setToken(savedToken);setUser(JSON.parse(savedUser))}catch(e){localStorage.removeItem('auth_token');localStorage.removeItem('user')}}setLoading(false)},[]);
  const handleLoginSuccess=({token,user})=>{setToken(token);setUser(user);localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));setCurrentPage('reconciliation')};
  const handleLogout=()=>{setToken(null);setUser(null);localStorage.removeItem('auth_token');localStorage.removeItem('user');setPublicView('landing')};
  if(loading)return <div className="app-loading"><span/><p>Loading Axiom Recon Builder…</p></div>;
  if(!token||!user){if(publicView==='login')return <div><button className="back-to-site" onClick={()=>setPublicView('landing')}>← Back to website</button><Login onLoginSuccess={handleLoginSuccess}/></div>;return <LandingPage onLogin={()=>setPublicView('login')} onStartTrial={()=>setPublicView('login')}/>}
  const titles={dashboard:'Dashboard',reconciliation:'Reconciliation',history:'History',rules:'Rules Engine',settings:'Settings'};
  return <div className="App"><div className="app-header"><div className="header-brand">Axiom Recon Builder</div><div className="header-divider"/><h1>{titles[currentPage]||'Axiom Recon Builder'}</h1><div className="header-spacer"/><UserProfile user={user} onLogout={handleLogout} onNavigateToSettings={()=>setCurrentPage('settings')}/></div><div className="app-main"><Sidebar user={user} currentPage={currentPage} onNavigate={setCurrentPage}/><div className="app-content">{currentPage==='dashboard'&&<Dashboard token={token} user={user}/>} {currentPage==='reconciliation'&&<ReconciliationTool token={token} user={user}/>} {currentPage==='history'&&<History token={token} user={user}/>} {currentPage==='rules'&&<Rules token={token} user={user}/>} {currentPage==='settings'&&<Settings token={token} user={user}/>}</div></div></div>
}
export default App;