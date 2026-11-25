import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleApi } from '../apps/console/auth.ts';

test('runtime controls reject unauthenticated access and noncanonical writes', async () => {
  const environment = { AUTH_URL: 'https://console.example.test/api/auth', AUTH_SECRET: 'fixture-only-secret', AUTH_GITHUB_ID: 'fixture-id', AUTH_GITHUB_SECRET: 'fixture-secret', CONSOLE_OWNER_GITHUB_ID: '123' };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    const url = 'https://console.example.test/api/controls';
    const denied = await consoleApi.fetch(new Request(url));
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('cache-control') ?? '', /no-store/);
    const wrongOrigin = await consoleApi.fetch(new Request(url, { method: 'POST', headers: { origin: 'https://other.example.test', 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(wrongOrigin.status, 403);
    const unauthenticated = await consoleApi.fetch(new Request(url, { method: 'POST', headers: { origin: 'https://console.example.test', 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(unauthenticated.status, 401);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
