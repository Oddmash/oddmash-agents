import { useRef, useState } from 'react';
import { Alert, Button } from '@oddmash/ui';

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
          <p>Monitor agent activity, review progress, and manage runtime settings.</p>
        </div>
        <div className="login-actions">
          {availability === 'unconfigured' && <Alert role="alert" tone="danger">Console authentication is not configured.</Alert>}
          {availability === 'error' && <p role="status">Unable to verify configuration. You can retry sign-in or reload this page.</p>}
          {(failed || errorMessage) && <Alert role="alert" tone="danger">{failed ? 'Unable to start GitHub sign-in. Please try again.' : errorMessage}</Alert>}
          {availability !== 'unconfigured' && <Button className="login-action" disabled={pending} onClick={() => void start()}>Sign in with GitHub</Button>}
          <span className="login-progress" role="status" aria-live="polite">{pending ? 'Opening GitHub sign-in.' : ''}</span>
        </div>
        <p className="login-restriction">Private workspace. Access is restricted to the authorized GitHub account.</p>
      </div>
    </main>
  );
};
