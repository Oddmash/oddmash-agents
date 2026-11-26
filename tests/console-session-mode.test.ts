import assert from 'node:assert/strict';
import test from 'node:test';
import { consoleApi } from '../apps/console/auth.ts';

test('first-party mode denies all protected reads and writes without first-party access', async () => {
  const environment = { AUTH_URL: 'https://console.example.test/api/auth', AUTH_SECRET: 'fixture-only-secret', AUTH_GITHUB_ID: 'fixture-id', AUTH_GITHUB_SECRET: 'fixture-secret', CONSOLE_OWNER_GITHUB_ID: '123', CONSOLE_SESSION_MODE: 'first-party', OPERATOR_STORE_URL: 'https://fixture.upstash.io', OPERATOR_STORE_READ_TOKEN: 'fixture-read', OPERATOR_STORE_WRITE_TOKEN: 'fixture-write' };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    const origin = 'https://console.example.test';
    const send = (path: string, method = 'GET', source = origin) => consoleApi.fetch(new Request(origin + path, { method, headers: { origin: source, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) }));
    assert.deepEqual(await (await send('/api/availability')).json(), { configured: true, sessionMode: 'first-party' });
    for (const path of ['/api/status', '/api/controls', '/api/models']) assert.equal((await send(path)).status, 401);
    for (const path of ['/api/controls', '/api/models']) assert.equal((await send(path, 'POST')).status, 401);
    assert.deepEqual(await (await send('/api/session/status')).json(), { authenticated: false });
    assert.equal((await send('/api/session/bootstrap', 'POST')).status, 401);
    assert.equal((await send('/api/session/refresh', 'POST')).status, 401);
    assert.equal((await send('/api/session/logout', 'POST', 'https://other.example.test')).status, 403);
    assert.equal((await send('/api/session/missing')).status, 404);
    delete process.env.OPERATOR_STORE_WRITE_TOKEN;
    assert.equal((await send('/api/status')).status, 401);
    process.env.CONSOLE_SESSION_MODE = 'invalid';
    assert.deepEqual(await (await send('/api/availability')).json(), { configured: false });
    process.env.CONSOLE_SESSION_MODE = 'legacy';
    assert.deepEqual(await (await send('/api/availability')).json(), { configured: true });
    assert.equal((await send('/api/session/status')).status, 404);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
