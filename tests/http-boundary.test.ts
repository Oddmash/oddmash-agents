import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedSessionId } from '../apps/console/auth-policy.ts';
import { consoleApi } from '../apps/console/auth.ts';
import { GET as statusGet } from '../api/status.ts';
import { GET as availabilityGet } from '../api/availability.ts';
import { POST as signInPost } from '../api/auth/signin/github.ts';
import { GET as callbackGet } from '../api/auth/callback/github.ts';
import { GET as authGet } from '../api/auth/[...path].ts';
import { GET as githubGet } from '../api/github.ts';
import { POST as advisoryPost } from '../api/advisory.ts';
import { workerEndpoint } from '../apps/worker/src/worker-http.ts';

test('deployed worker entrypoint returns its public health contract', async () => {
  const response = await githubGet(new Request('https://localhost/api/github'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: 'Oddmash Reviewer', status: 'ok' });
});

test('root console functions preserve fail-closed routes separately from worker health', async () => {
  const previous = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const origin = 'https://console.example.invalid';
    const availability = await availabilityGet(new Request(origin + '/api/availability'));
    assert.deepEqual(await availability.json(), { configured: false });
    const status = await statusGet(new Request(origin + '/api/status'));
    assert.equal(status.status, 401);
    assert.equal(status.headers.get('cache-control'), 'private, no-store');
    assert.equal((await authGet(new Request(origin + '/api/auth/session'))).status, 503);
    assert.equal((await signInPost(new Request(origin + '/api/auth/signin/github', { method: 'POST' }))).status, 503);
    assert.equal((await callbackGet(new Request(origin + '/api/auth/callback/github'))).status, 503);
    assert.equal((await statusGet(new Request(origin + '/api/github'))).status, 404);
    assert.equal((await githubGet(new Request(origin + '/api/github'))).status, 200);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

test('Hono worker preserves method, path and raw webhook request', async () => {
  const app = workerEndpoint('/api/github', async request => new Response(await request.text(), { status: 202 }), () => Response.json({ ok: true }));
  const health = await app.request('/api/github');
  assert.equal(health.status, 200);
  const response = await app.request('/api/github', { method: 'POST', body: 'fixture' });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), 'fixture');
  assert.equal((await app.request('/api/other', { method: 'POST' })).status, 404);
  const failing = workerEndpoint('/api/github', async () => { throw new Error('fixture'); });
  assert.equal((await failing.request('/api/github', { method: 'POST' })).status, 500);
});

test('console status and auth fail closed without configuration', async () => {
  const previous = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const availability = await consoleApi.request('/api/availability');
    assert.deepEqual(await availability.json(), { configured: false });
    const status = await consoleApi.request('/api/status');
    assert.equal(status.status, 401);
    assert.equal(status.headers.get('cache-control'), 'private, no-store');
    assert.equal((await consoleApi.request('/api/auth/session')).status, 503);
    assert.equal((await consoleApi.request('/api/status', { method: 'POST' })).status, 404);
    assert.equal((await consoleApi.request('/api/unknown', { method: 'POST' })).status, 404);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

test('configured console still rejects missing session and noncanonical auth origin', async () => {
  const keys = ['AUTH_SECRET', 'AUTH_URL', 'AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET', 'CONSOLE_OWNER_GITHUB_ID'];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.AUTH_SECRET = 'synthetic-console-session-secret-32-bytes';
    process.env.AUTH_URL = 'https://console.example.invalid/api/auth';
    process.env.AUTH_GITHUB_ID = 'fixture-client';
    process.env.AUTH_GITHUB_SECRET = 'fixture-client-secret';
    process.env.CONSOLE_OWNER_GITHUB_ID = '123';
    const response = await consoleApi.request('https://console.example.invalid/api/status');
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await consoleApi.request('https://other.example.invalid/api/auth/session')).status, 400);
    for (const response of [await signInPost(new Request('https://other.example.invalid/api/auth/signin/github', { method: 'POST' })), await callbackGet(new Request('https://other.example.invalid/api/auth/callback/github'))]) {
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(await response.json(), { error: 'Invalid console origin' });
    }
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test('exported advisory POST matches the deployed path and preserves query routing', async () => {
  const previous = process.env.QA_APP_ENABLED;
  process.env.QA_APP_ENABLED = 'false';
  try {
    const response = await advisoryPost(new Request('https://worker.example.invalid/api/advisory?agent=qa', { method: 'POST' }));
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'Unavailable');
    const unknown = await advisoryPost(new Request('https://worker.example.invalid/api/advisory?agent=unknown', { method: 'POST' }));
    assert.equal(unknown.status, 404);
    assert.equal(await unknown.text(), 'Not found');
  } finally {
    if (previous === undefined) delete process.env.QA_APP_ENABLED; else process.env.QA_APP_ENABLED = previous;
  }
});

test('only the currently configured owner receives a valid projected session ID', () => {
  assert.equal(authorizedSessionId('123', '123'), '123');
  assert.equal(authorizedSessionId('123', '124'), '');
  assert.equal(authorizedSessionId(undefined, '123'), '');
  assert.equal(authorizedSessionId('123', undefined), '');
});

test('worker failures record only a static endpoint and return a generic response', async t => {
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  const app = workerEndpoint('/api/github', async () => { throw new Error('synthetic exception detail'); });
  const response = await app.request('/api/github', { method: 'POST' });
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Internal server error');
  assert.deepEqual(logs, [['Worker HTTP request failed', { endpoint: '/api/github' }]]);
});
