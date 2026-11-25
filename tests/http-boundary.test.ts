import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleApi } from '../apps/console/auth.ts';
import { POST as advisoryPost } from '../api/advisory.ts';
import { workerEndpoint } from '../src/worker-http.ts';

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
