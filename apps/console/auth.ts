import { Hono } from 'hono';
import { initAuthConfig, authHandler, verifyAuth } from '@hono/auth-js';
import GitHub from '@auth/core/providers/github';
import { isAuthorizedOwner } from './auth-policy.ts';
import { operatorStoreConfig, readOperatorStatus } from '@oddmash/agent-operator-store';

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
  if (!authConfigured()) {
    if (c.req.path === '/api/availability' && c.req.method === 'GET') return c.json({ configured: false });
    return c.json({ error: 'Unauthorized or unavailable' }, c.req.path === '/api/status' ? 401 : 503);
  }
  await next();
});
consoleApi.get('/api/availability', c => c.json({ configured: true }));
consoleApi.use('/api/*', initAuthConfig(() => ({
  secret: process.env.AUTH_SECRET!,
  basePath: '/api/auth',
  trustHost: true,
  providers: [GitHub({ clientId: process.env.AUTH_GITHUB_ID!, clientSecret: process.env.AUTH_GITHUB_SECRET!, authorization: { params: { scope: 'read:user' } } })],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  callbacks: {
    signIn({ account, profile }) { return account?.provider === 'github' && owner(profile?.id); },
    jwt({ token, account, profile }) {
      if (account?.provider === 'github') token.operatorId = owner(profile?.id) ? String(profile?.id) : undefined;
      return token;
    },
    session({ session, token }) {
      return { expires: session.expires, user: { id: typeof token.operatorId === 'string' ? token.operatorId : '' } };
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
consoleApi.onError((error, c) => {
  if ('status' in error && error.status === 401) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ error: 'Request unavailable' }, 503);
});
