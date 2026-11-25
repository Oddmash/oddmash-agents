import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authConfigManager, SessionProvider, useSession, signIn, signOut } from '@hono/auth-js/react';
import { Dashboard } from './dashboard';
import '@oddmash/ui/styles.css';
import './globals.css';

authConfigManager.setConfig({ basePath: '/api/auth' });

function Console() {
  const { status, data } = useSession();
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/availability', { cache: 'no-store', signal: abort.signal })
      .then(response => response.ok ? response.json() : { configured: false })
      .then(value => setConfigured(value.configured === true))
      .catch(() => { if (!abort.signal.aborted) setConfigured(false); });
    return () => abort.abort();
  }, []);
  if (configured === false) return <main className="login"><h1>Oddmash Agents</h1><p>Console authentication is not configured or unavailable.</p></main>;
  if (configured === null || status === 'loading') return <main className="login"><h1>Oddmash Agents</h1><p role="status">Checking session…</p></main>;
  if (status !== 'authenticated' || !data?.user) return <main className="login"><p className="eyebrow">ODDMASH / OPERATIONS</p><h1>Agents Console</h1><p>Sign in with the authorized GitHub account to view agent activity.</p><button className="login-button" onClick={() => void signIn('github', { callbackUrl: window.location.origin })}>Sign in with GitHub</button></main>;
  return <Dashboard logout={<button className="login-button" onClick={() => void signOut({ callbackUrl: window.location.origin })}>Sign out</button>} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><Console /></SessionProvider></StrictMode>);
