type SessionCheck = { state: 'authenticated' | 'unauthenticated' | 'unavailable' | 'retrying'; nextMs?: number };
export const logoutPendingKey = 'oddmash-console-logout-pending';
export const readLogoutPending = (storage: Pick<Storage, 'getItem'>): boolean => { try { return storage.getItem(logoutPendingKey) === '1'; } catch { return false; } };
export const writeLogoutPending = (storage: Pick<Storage, 'setItem' | 'removeItem'>, pending: boolean): void => { try { if (pending) storage.setItem(logoutPendingKey, '1'); else storage.removeItem(logoutPendingKey); } catch {} };
const statusRequest = (request: typeof fetch) => request('/api/session/status', { cache: 'no-store', credentials: 'same-origin' });
export const sessionWrite = (path: 'bootstrap' | 'refresh' | 'logout', request = fetch) => request('/api/session/' + path, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });

const readStatus = async (request: typeof fetch): Promise<SessionCheck> => {
  const response = await statusRequest(request);
  if (!response.ok) return { state: 'unavailable' };
  const value = await response.json() as { authenticated?: unknown; refreshAfterMs?: unknown };
  if (value.authenticated === false) return { state: 'unauthenticated' };
  if (value.authenticated !== true || typeof value.refreshAfterMs !== 'number' || !Number.isFinite(value.refreshAfterMs) || value.refreshAfterMs < 0) return { state: 'unavailable' };
  return { state: 'authenticated', nextMs: Math.min(30_000, value.refreshAfterMs) };
};

export async function checkFirstPartySession(request: typeof fetch, canBootstrap: boolean): Promise<SessionCheck> {
  try {
    const current = await readStatus(request);
    if (current.state === 'unavailable' || (current.state === 'authenticated' && current.nextMs! > 0)) return current;
    const refresh = await sessionWrite('refresh', request);
    if (refresh.ok) return { state: 'authenticated', nextMs: 30_000 };
    if (refresh.status === 409) {
      const winner = await readStatus(request);
      return winner.state === 'authenticated' ? { ...winner, nextMs: Math.max(1_000, winner.nextMs ?? 0) } : winner.state === 'unavailable' ? winner : { state: 'retrying', nextMs: 5_000 };
    }
    if (refresh.status !== 401) return { state: 'unavailable' };
    if (!canBootstrap) return { state: 'unauthenticated' };
    const bootstrap = await sessionWrite('bootstrap', request);
    if (bootstrap.ok) return { state: 'authenticated', nextMs: 30_000 };
    if (bootstrap.status === 401 || bootstrap.status === 409) return readStatus(request);
    return { state: 'unavailable' };
  } catch { return { state: 'unavailable' }; }
}
