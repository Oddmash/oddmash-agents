import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authConfigManager, SessionProvider, useSession, signIn, signOut } from '@hono/auth-js/react';
import { Dashboard } from './dashboard';
import '@oddmash/ui/styles.css';
import './globals.css';

authConfigManager.setConfig({ basePath: '/api/auth' });

function Console() {
  const { status, data } = useSession();
  const [signInError, setSignInError] = useState(false);
  const [configured, setConfigured] = useState<'checking' | 'ready' | 'unconfigured' | 'error'>('checking');
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/availability', { cache: 'no-store', signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error('Availability unavailable'); return response.json(); })
      .then(value => setConfigured(value.configured === true ? 'ready' : value.configured === false ? 'unconfigured' : 'error'))
      .catch(() => { if (!abort.signal.aborted) setConfigured('error'); });
    return () => abort.abort();
  }, []);
  if (configured === 'checking' || status === 'loading') return <main className="login"><h1>Oddmash Agents</h1><p role="status">Checking session…</p></main>;
  if (configured === 'unconfigured') return <main className="login"><h1>Oddmash Agents</h1><p>Console authentication is not configured.</p></main>;
  if (status !== 'authenticated' || !data?.user?.id) return <main className="login"><p className="eyebrow">ODDMASH / OPERATIONS</p><h1>Agents Console</h1><p>Sign in with the authorized GitHub account to view agent activity.</p>{configured === 'error' && <p role="status">Unable to verify configuration. You can retry sign-in or reload this page.</p>}{signInError && <p role="alert">Unable to start GitHub sign-in. Please try again.</p>}<button className="login-button" onClick={() => { setSignInError(false); void signIn('github', { callbackUrl: window.location.origin }).catch(() => setSignInError(true)); }}>Sign in with GitHub</button></main>;
  return <Dashboard logout={<button className="login-button" onClick={() => void signOut({ callbackUrl: window.location.origin })}>Sign out</button>} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><Console /></SessionProvider></StrictMode>);
