import { Hono, type Context, type Next } from 'hono';
import { randomBytes } from 'node:crypto';
import { createSessionHttp } from './session-http.ts';
import { createSessionStore } from './session-store.ts';
import { initAuthConfig, authHandler, verifyAuth } from '@hono/auth-js';
import GitHub from '@auth/core/providers/github';
import { authorizedSessionId, isAuthorizedOwner } from './auth-policy.ts';
import { operatorStoreConfig, readOperatorStatus, readOperatorControls, saveOperatorControls, readOperatorModels, saveOperatorModels } from '../../packages/operator-store/src/index.ts';

import { modelPolicy } from '../../packages/operator-contract/src/model-settings.ts';
import { handleModelWrite } from './model-request.ts';
import { verifyModelAvailability } from './model-availability.ts';
import { handleControlWrite } from './control-request.ts';
import { readContributorPulls } from './contributor-pulls.ts';
import { readAdoptionMetrics } from './adoption-metrics.ts';

function owner(id: unknown) { return isAuthorizedOwner(id, process.env.CONSOLE_OWNER_GITHUB_ID); }
const firstPartyMode = () => process.env.CONSOLE_SESSION_MODE === 'first-party';
const configuredMode = () => process.env.CONSOLE_SESSION_MODE === undefined || process.env.CONSOLE_SESSION_MODE === 'legacy' || firstPartyMode();
const sessionHttp = (write = false) => {
  const ownerId = process.env.CONSOLE_OWNER_GITHUB_ID!;
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, write ? process.env.OPERATOR_STORE_WRITE_TOKEN : process.env.OPERATOR_STORE_READ_TOKEN);
  if (!config) throw new Error('Session store unavailable');
  return createSessionHttp({ store: createSessionStore(config, ownerId), ownerId, origin: new URL(process.env.AUTH_URL!).origin, key: process.env.AUTH_SECRET! });
};
const dataAuth = async (c: Context, next: Next) => {
  if (!firstPartyMode()) return verifyAuth()(c, next);
  try {
    if (!await sessionHttp().accessAuthorized(c.req.raw)) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  } catch { return c.json({ error: 'Session unavailable' }, 503); }
};

export function authConfigured() {
  try {
    const url = new URL(process.env.AUTH_URL ?? '');
    return Boolean(configuredMode() && (!firstPartyMode() || (operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_READ_TOKEN) && operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_WRITE_TOKEN))) && process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && /^[1-9]\d*$/.test(process.env.CONSOLE_OWNER_GITHUB_ID ?? '') &&
      url.pathname === '/api/auth' && !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))));
  } catch { return false; }
}

export const consoleApi = new Hono();
consoleApi.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  const authRoute = c.req.path.startsWith('/api/auth/');
  const readRoute = c.req.method === 'GET' && ['/api/availability', '/api/status', '/api/controls', '/api/models', '/api/contributors', '/api/adoption'].includes(c.req.path);
  const sessionRead = firstPartyMode() && c.req.method === 'GET' && c.req.path === '/api/session/status';
  const sessionWrite = firstPartyMode() && c.req.method === 'POST' && ['/api/session/bootstrap', '/api/session/refresh', '/api/session/logout'].includes(c.req.path);
  const controlWrite = c.req.method === 'POST' && ['/api/controls', '/api/models'].includes(c.req.path);
  if (!readRoute && !controlWrite && !sessionRead && !sessionWrite && !(authRoute && ['GET', 'POST'].includes(c.req.method))) return c.json({ error: 'Not found' }, 404);
  if (!authConfigured()) {
    if (c.req.path === '/api/availability' && c.req.method === 'GET') return c.json(firstPartyMode() ? { configured: false, sessionMode: 'first-party' } : { configured: false });
    return c.json({ error: 'Unauthorized or unavailable' }, ['/api/status', '/api/controls', '/api/models', '/api/contributors', '/api/adoption'].includes(c.req.path) ? 401 : 503);
  }
  if ((controlWrite || sessionWrite) && (c.req.header('origin') !== new URL(process.env.AUTH_URL!).origin || new URL(c.req.url).origin !== new URL(process.env.AUTH_URL!).origin || c.req.header('content-type')?.split(';')[0] !== 'application/json')) return c.json({ error: 'Invalid console origin or content type' }, 403);
  if (c.req.path.startsWith('/api/auth/') && new URL(c.req.url).origin !== new URL(process.env.AUTH_URL!).origin) return c.json({ error: 'Invalid console origin' }, 400);
  await next();
});
consoleApi.get('/api/availability', c => c.json(firstPartyMode() ? { configured: true, sessionMode: 'first-party' } : { configured: true }));
consoleApi.use('/api/*', initAuthConfig(() => ({
  secret: process.env.AUTH_SECRET!,
  basePath: '/api/auth',
  trustHost: true,
  pages: { signIn: '/', error: '/' },
  providers: [GitHub({ clientId: process.env.AUTH_GITHUB_ID!, clientSecret: process.env.AUTH_GITHUB_SECRET!, authorization: { params: { scope: 'read:user', prompt: 'select_account' } } })],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  callbacks: {
    signIn({ account, profile }) { return account?.provider === 'github' && owner(profile?.id); },
    jwt({ token, account, profile }) {
      if (account?.provider === 'github') {
        token.operatorId = owner(profile?.id) ? String(profile?.id) : undefined;
        if (firstPartyMode() && token.operatorId) {
          token.operatorBootstrap = randomBytes(32).toString('base64url');
          token.operatorSignedInAt = Date.now();
        }
      }
      return token;
    },
    session({ session, token }) {
      return { expires: session.expires, user: { id: authorizedSessionId(token.operatorId, process.env.CONSOLE_OWNER_GITHUB_ID) } };
    }
  }
})));
consoleApi.on(['GET', 'POST'], '/api/auth/*', authHandler());
consoleApi.get('/api/session/status', async c => sessionHttp().status(c.req.raw));
consoleApi.post('/api/session/bootstrap', verifyAuth(), async c => {
  const token = c.get('authUser').token;
  const verified = token && owner(token.operatorId) && typeof token.operatorBootstrap === 'string' && typeof token.operatorSignedInAt === 'number' ? { ownerId: String(token.operatorId), nonce: token.operatorBootstrap, signedInAt: token.operatorSignedInAt } : undefined;
  return sessionHttp(true).bootstrap(c.req.raw, verified);
});
consoleApi.post('/api/session/refresh', async c => sessionHttp(true).refresh(c.req.raw));
consoleApi.post('/api/session/logout', async c => sessionHttp(true).logout(c.req.raw));
consoleApi.get('/api/adoption', dataAuth, async c => {
  if (!firstPartyMode() && !owner(c.get('authUser').token?.operatorId)) return c.json({ error: 'Unauthorized' }, 401);
  try { return c.json({ metrics: await readAdoptionMetrics() }); }
  catch { return c.json({ error: 'Adoption metrics unavailable' }, 503); }
});
consoleApi.get('/api/contributors', dataAuth, async c => {
  if (!firstPartyMode() && !owner(c.get('authUser').token?.operatorId)) return c.json({ error: 'Unauthorized' }, 401);
  try { return c.json(await readContributorPulls(process.env.CONSOLE_OWNER_GITHUB_ID!)); }
  catch { return c.json({ error: 'Contributor PR source unavailable' }, 503); }
});
consoleApi.get('/api/status', dataAuth, async c => {
  if (!firstPartyMode() && !owner(c.get('authUser').token?.operatorId)) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const status = await readOperatorStatus(operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_READ_TOKEN));
    return c.json(status);
  } catch { return c.json({ error: 'Status source unavailable' }, 503); }
});
consoleApi.get('/api/controls', dataAuth, async c => {
  if (!firstPartyMode() && !owner(c.get('authUser').token?.operatorId)) return c.json({ error: 'Unauthorized' }, 401);
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_READ_TOKEN);
  if (!config) return c.json({ error: 'Controls unavailable' }, 503);
  try { return c.json(await readOperatorControls(config)); } catch { return c.json({ error: 'Controls unavailable' }, 503); }
});
consoleApi.post('/api/controls', dataAuth, async c => {
  const id = firstPartyMode() ? process.env.CONSOLE_OWNER_GITHUB_ID : c.get('authUser').token?.operatorId;
  if (!owner(id)) return c.json({ error: 'Unauthorized' }, 401);
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_WRITE_TOKEN);
  if (!config) return c.json({ error: 'Controls unavailable' }, 503);
  try {
    const result = await handleControlWrite(c.req.raw, (revision, controls) => saveOperatorControls(config, revision, controls, String(id)));
    return c.json(result.body, result.status);
  } catch { return c.json({ error: 'Controls unavailable' }, 503); }
});
consoleApi.get('/api/models', dataAuth, async c => {
  if (!firstPartyMode() && !owner(c.get('authUser').token?.operatorId)) return c.json({ error: 'Unauthorized' }, 401);
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_READ_TOKEN);
  if (!config) return c.json({ error: 'Model settings unavailable' }, 503);
  try { return c.json({ ...await readOperatorModels(config), policy: modelPolicy(process.env) }); }
  catch { return c.json({ error: 'Model settings unavailable' }, 503); }
});
consoleApi.post('/api/models', dataAuth, async c => {
  const id = firstPartyMode() ? process.env.CONSOLE_OWNER_GITHUB_ID : c.get('authUser').token?.operatorId;
  if (!owner(id)) return c.json({ error: 'Unauthorized' }, 401);
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_WRITE_TOKEN);
  if (!config) return c.json({ error: 'Model settings unavailable' }, 503);
  try {
    const result = await handleModelWrite(c.req.raw, modelPolicy(process.env), overrides => verifyModelAvailability(overrides), (revision, overrides) => saveOperatorModels(config, revision, overrides, String(id)));
    return c.json(result.body, result.status);
  } catch { return c.json({ error: 'Model settings unavailable' }, 503); }
});
consoleApi.onError((error, c) => {
  if ('status' in error && error.status === 401) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ error: 'Request unavailable' }, 503);
});
