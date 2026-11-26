import { useEffect, useRef, useState } from 'react';
import { checkFirstPartySession, sessionWrite, logoutPendingKey, readLogoutPending, writeLogoutPending } from './session-client';

type State = 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable' | 'logout-pending';
let inFlight: ReturnType<typeof checkFirstPartySession> | undefined;
const sharedCheck = (canBootstrap: boolean) => {
  if (!inFlight) inFlight = checkFirstPartySession(fetch, canBootstrap).finally(() => { inFlight = undefined; });
  return inFlight;
};

export function useFirstPartySession(enabled: boolean, authReady: boolean, canBootstrap: boolean) {
  const [state, setState] = useState<State>(() => readLogoutPending(localStorage) ? 'logout-pending' : 'checking');
  const loggingOut = useRef(readLogoutPending(localStorage));
  useEffect(() => {
    if (!enabled || !authReady) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, checking = false;
    const check = async () => {
      if (disposed || checking || loggingOut.current || document.hidden) return;
      checking = true;
      const result = await sharedCheck(canBootstrap);
      checking = false;
      if (disposed || loggingOut.current) return;
      setState(result.state === 'retrying' ? 'checking' : result.state);
      if (result.nextMs !== undefined) timer = setTimeout(check, Math.max(1_000, result.nextMs));
      else if (result.state === 'unavailable') timer = setTimeout(check, 30_000);
    };
    const onVisibility = () => { if (timer) clearTimeout(timer); if (!document.hidden) void check(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== logoutPendingKey || event.newValue !== '1') return;
      loggingOut.current = true;
      setState('logout-pending');
      if (timer) clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onStorage);
    void check();
    return () => { disposed = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('storage', onStorage); };
  }, [enabled, authReady, canBootstrap]);
  const logout = async (): Promise<boolean> => {
    loggingOut.current = true;
    writeLogoutPending(localStorage, true);
    setState('logout-pending');
    if (inFlight) await inFlight;
    try {
      const response = await sessionWrite('logout');
      if (!response.ok) return false;
      writeLogoutPending(localStorage, false);
      setState('unauthenticated');
      return true;
    } catch { return false; }
  };
  return { state, logout };
}
