import { authorizeSession, issueSession, revokeSession, rotateSession, type SessionCredentials } from './session-family.ts';
import { parseSessionState, transactSession, type SessionStore } from './session-store.ts';

const accessName = '__Host-oddmash-access';
const refreshName = '__Host-oddmash-refresh';
type Bootstrap = { ownerId: string; nonce: string; signedInAt: number };
type Options = { store: SessionStore; ownerId: string; origin: string; key: string; now?: () => number };

const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`;
const readCookie = (request: Request, name: string) => {
  const values = (request.headers.get('cookie') ?? '').split(';').map(entry => entry.trim()).filter(entry => entry.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
};
const reply = (status: number, authenticated: boolean, cookies: string[] = []) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify({ authenticated }), { status, headers });
};
const expired = (name: string) => cookie(name, '', 0);

export function createSessionHttp(options: Options) {
  const clock = options.now ?? Date.now;
  const validOrigin = (request: Request) => new URL(request.url).origin === options.origin;
  const validWrite = (request: Request) => request.method === 'POST' && validOrigin(request) && request.headers.get('origin') === options.origin && request.headers.get('content-type')?.split(';')[0].trim() === 'application/json';
  const setCredentials = (credentials: SessionCredentials, at: number) => [cookie(accessName, credentials.access, credentials.accessExpiresAt - at), cookie(refreshName, credentials.refresh, credentials.expiresAt - at)];
  const accessAuthorized = async (request: Request) => {
    if (!validOrigin(request)) return false;
    const access = readCookie(request, accessName);
    if (!access) return false;
    const state = parseSessionState(await options.store.read(), options.ownerId);
    return authorizeSession(state, access, options.ownerId, clock(), options.key);
  };
  return {
    accessAuthorized,
    async status(request: Request) {
      if (request.method !== 'GET' || !validOrigin(request)) return reply(403, false);
      try { return reply(200, await accessAuthorized(request)); } catch { return reply(503, false); }
    },
    async bootstrap(request: Request, verified: Bootstrap | undefined) {
      if (!validWrite(request)) return reply(403, false);
      if (!verified) return reply(401, false);
      try {
        const at = clock();
        const result = await transactSession(options.store, options.ownerId, state => issueSession(state, verified.ownerId, options.ownerId, verified.nonce, verified.signedInAt, at, options.key));
        return result.outcome === 'issued' ? reply(200, true, setCredentials(result.credentials, at)) : reply(result.outcome === 'capacity' ? 409 : 401, false);
      } catch { return reply(503, false); }
    },
    async refresh(request: Request) {
      if (!validWrite(request)) return reply(403, false);
      const refresh = readCookie(request, refreshName);
      if (!refresh) return reply(401, false);
      try {
        const at = clock();
        const result = await transactSession(options.store, options.ownerId, state => rotateSession(state, refresh, options.ownerId, at, options.key));
        if (result.outcome === 'rotated') return reply(200, true, setCredentials(result.credentials, at));
        if (result.outcome === 'conflict' || result.outcome === 'too-early') return reply(409, false);
        return reply(401, false);
      } catch { return reply(503, false); }
    },
    async logout(request: Request) {
      if (!validWrite(request)) return reply(403, false);
      const refresh = readCookie(request, refreshName), access = readCookie(request, accessName);
      try {
        if (refresh || access) await transactSession(options.store, options.ownerId, state => {
          const result = revokeSession(state, refresh || access, options.ownerId, clock(), options.key);
          return result.outcome === 'denied' && access && refresh ? revokeSession(state, access, options.ownerId, clock(), options.key) : result;
        });
        return reply(200, false, [expired(accessName), expired(refreshName)]);
      } catch { return reply(503, false, [expired(accessName)]); }
    }
  };
}
