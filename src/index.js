import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { configError } from './lib/supabaseClient';

const ConfigError = ({ message }) => (
  <main style={{ maxWidth: 560, margin: '15vh auto', padding: 24, fontFamily: 'system-ui', color: '#10243a' }}>
    <h1 style={{ fontSize: 22 }}>Axiom Recon Builder is not configured</h1>
    <p style={{ lineHeight: 1.6 }}>{message}</p>
  </main>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {configError ? <ConfigError message={configError} /> : <App />}
  </React.StrictMode>
);
