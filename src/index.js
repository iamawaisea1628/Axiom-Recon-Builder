import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { configError } from './lib/supabaseClient';

const box = { maxWidth: 640, margin: '12vh auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#10243a' };

const ConfigError = ({ message }) => (
  <main style={box}>
    <h1 style={{ fontSize: 22 }}>Axiom Recon Builder is not configured</h1>
    <p style={{ lineHeight: 1.6 }}>{message}</p>
  </main>
);

// Shows the error on screen instead of a blank page, so it can be reported and fixed.
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('App crashed:', error, info && info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={box}>
        <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
        <p style={{ lineHeight: 1.6 }}>The page hit an unexpected error. Reloading usually helps; if it keeps happening, send this message to support.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f6f8', padding: 12, borderRadius: 8, fontSize: 13 }}>
          {String((this.state.error && this.state.error.message) || this.state.error)}
        </pre>
        <button onClick={() => window.location.reload()} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #cbd5dc', background: '#fff', cursor: 'pointer' }}>Reload</button>
      </main>
    );
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>{configError ? <ConfigError message={configError} /> : <App />}</ErrorBoundary>
  </React.StrictMode>
);
