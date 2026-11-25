import { Hono } from 'hono';
import { initAuthConfig, authHandler, verifyAuth } from '@hono/auth-js';
import GitHub from '@auth/core/providers/github';
import { authorizedSessionId, isAuthorizedOwner } from './auth-policy.ts';
import { operatorStoreConfig, readOperatorStatus, readOperatorControls, saveOperatorControls } from '../../packages/operator-store/src/index.ts';

import { handleControlWrite } from './control-request.ts';

function owner(id: unknown) { return isAuthorizedOwner(id, process.env.CONSOLE_OWNER_GITHUB_ID); }

export function authConfigured() {
  try {
    const url = new URL(process.env.AUTH_URL ?? '');
    return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && /^[1-9]\d*$/.test(process.env.CONSOLE_OWNER_GITHUB_ID ?? '') &&
      url.pathname === '/api/auth' && !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))));
  } catch { return false; }
}

export const consoleApi = new Hono();
consoleApi.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  const authRoute = c.req.path.startsWith('/api/auth/');
  const readRoute = c.req.method === 'GET' && ['/api/availability', '/api/status', '/api/controls'].includes(c.req.path);
  const controlWrite = c.req.method === 'POST' && c.req.path === '/api/controls';
  if (!readRoute && !controlWrite && !(authRoute && ['GET', 'POST'].includes(c.req.method))) return c.json({ error: 'Not found' }, 404);
  if (!authConfigured()) {
    if (c.req.path === '/api/availability' && c.req.method === 'GET') return c.json({ configured: false });
    return c.json({ error: 'Unauthorized or unavailable' }, ['/api/status', '/api/controls'].includes(c.req.path) ? 401 : 503);
  }
  if (controlWrite && (c.req.header('origin') !== new URL(process.env.AUTH_URL!).origin || new URL(c.req.url).origin !== new URL(process.env.AUTH_URL!).origin || c.req.header('content-type')?.split(';')[0] !== 'application/json')) return c.json({ error: 'Invalid console origin or content type' }, 403);
  if (c.req.path.startsWith('/api/auth/') && new URL(c.req.url).origin !== new URL(process.env.AUTH_URL!).origin) return c.json({ error: 'Invalid console origin' }, 400);
  await next();
});
consoleApi.get('/api/availability', c => c.json({ configured: true }));
consoleApi.use('/api/*', initAuthConfig(() => ({
  secret: process.env.AUTH_SECRET!,
  basePath: '/api/auth',
  trustHost: true,
  providers: [GitHub({ clientId: process.env.AUTH_GITHUB_ID!, clientSecret: process.env.AUTH_GITHUB_SECRET!, authorization: { params: { scope: 'read:user', prompt: 'select_account' } } })],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  callbacks: {
    signIn({ account, profile }) { return account?.provider === 'github' && owner(profile?.id); },
    jwt({ token, account, profile }) {
      if (account?.provider === 'github') token.operatorId = owner(profile?.id) ? String(profile?.id) : undefined;
      return token;
    },
    session({ session, token }) {
      return { expires: session.expires, user: { id: authorizedSessionId(token.operatorId, process.env.CONSOLE_OWNER_GITHUB_ID) } };
    }
  }
})));
consoleApi.on(['GET', 'POST'], '/api/auth/*', authHandler());
consoleApi.get('/api/status', verifyAuth(), async c => {
  if (!owner(c.get('authUser').token?.operatorId)) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const status = await readOperatorStatus(operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_READ_TOKEN));
    return c.json(status);
  } catch { return c.json({ error: 'Status source unavailable' }, 503); }
});
consoleApi.get('/api/controls', verifyAuth(), async c => {
  if (!owner(c.get('authUser').token?.operatorId)) return c.json({ error: 'Unauthorized' }, 401);
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_READ_TOKEN);
  if (!config) return c.json({ error: 'Controls unavailable' }, 503);
  try { return c.json(await readOperatorControls(config)); } catch { return c.json({ error: 'Controls unavailable' }, 503); }
});
consoleApi.post('/api/controls', verifyAuth(), async c => {
  const id = c.get('authUser').token?.operatorId;
  if (!owner(id)) return c.json({ error: 'Unauthorized' }, 401);
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_WRITE_TOKEN);
  if (!config) return c.json({ error: 'Controls unavailable' }, 503);
  try {
    const result = await handleControlWrite(c.req.raw, (revision, controls) => saveOperatorControls(config, revision, controls, String(id)));
    return c.json(result.body, result.status);
  } catch { return c.json({ error: 'Controls unavailable' }, 503); }
});
consoleApi.onError((error, c) => {
  if ('status' in error && error.status === 401) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ error: 'Request unavailable' }, 503);
});
