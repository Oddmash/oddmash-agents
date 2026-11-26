import { useRef, useState } from 'react';
import { Alert, Button } from '@oddmash/ui';
import { JuliyaText } from '@oddmash/juliya/react';

type SignInAvailability = 'ready' | 'unconfigured' | 'error';

export const SignInScreen = ({ availability, errorMessage, onSignIn }: { availability: SignInAvailability; errorMessage?: string; onSignIn: () => Promise<void> }) => {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = async () => {
    if (inFlight.current || availability === 'unconfigured') return;
    inFlight.current = true;
    setFailed(false);
    setPending(true);
    try { await onSignIn(); }
    catch { setFailed(true); }
    finally { inFlight.current = false; setPending(false); }
  };
  return (
    <main className="login" lang="en">
      <div className="login-panel">
        <div className="login-brand"><img src="/oddmash-logo.png" alt="" className="login-mark"/><span>oddmash.</span></div>
        <div className="login-intro">
          <p className="login-kicker">Operations</p>
          <h1>Agents Console</h1>
          <JuliyaText as="p" locale="en">Monitor agent activity, review progress, and manage settings.</JuliyaText>
        </div>
        <div className="login-actions">
          {availability === 'unconfigured' && <Alert role="alert" tone="danger"><JuliyaText as="span" locale="en">Console authentication is not configured.</JuliyaText></Alert>}
          {availability === 'error' && <JuliyaText as="p" locale="en" role="status">Unable to verify configuration. Retry sign-in or reload the page.</JuliyaText>}
          {(failed || errorMessage) && <Alert role="alert" tone="danger"><JuliyaText as="span" locale="en">{failed ? 'Unable to start GitHub sign-in. Please try again.' : errorMessage ?? ''}</JuliyaText></Alert>}
          {availability !== 'unconfigured' && <Button className="login-action" disabled={pending} aria-busy={pending} onClick={() => void start()}>
            <svg className="login-github-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.11c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.42.11-2.96 0 0 .95-.3 3.09 1.15a10.8 10.8 0 0 1 5.62 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.68.11 2.96.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.03.76 2.08v3.12c0 .3.21.65.77.54A11.25 11.25 0 0 0 12 .75Z"/></svg>
            <span>{pending ? 'Redirecting...' : 'Sign in with GitHub'}</span>
          </Button>}
          <span className="login-progress" role="status" aria-live="polite">{pending ? 'Redirecting to GitHub.' : ''}</span>
        </div>
        <JuliyaText as="p" locale="en" className="login-restriction">Private workspace. Authorized GitHub account only.</JuliyaText>
      </div>
    </main>
  );
};
