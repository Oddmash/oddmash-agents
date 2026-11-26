import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFirstPartySession } from '../apps/console/src/session-client.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const scripted = (responses: Response[]) => {
  const calls: string[] = [];
  const request: typeof fetch = async input => { calls.push(String(input)); const next = responses.shift(); if (!next) throw new Error('unexpected call'); return next; };
  return { calls, request };
};

test('existing access checks do not renew before the refresh window', async () => {
  const { request, calls } = scripted([json({ authenticated: true, refreshAfterMs: 90_000 })]);
  assert.deepEqual(await checkFirstPartySession(request, true), { state: 'authenticated', nextMs: 30_000 });
  assert.deepEqual(calls, ['/api/session/status']);
});

test('current refresh wins without a legacy bootstrap and conflict rereads only status', async () => {
  const { request, calls } = scripted([json({ authenticated: false }), json({}, 409), json({ authenticated: true, refreshAfterMs: 60_000 })]);
  assert.equal((await checkFirstPartySession(request, true)).state, 'authenticated');
  assert.deepEqual(calls, ['/api/session/status', '/api/session/refresh', '/api/session/status']);
});

test('bootstrap requires verified OAuth readiness; unavailable storage never falls back to legacy auth', async () => {
  const noOwner = scripted([json({ authenticated: false }), json({}, 401)]);
  assert.equal((await checkFirstPartySession(noOwner.request, false)).state, 'unauthenticated');
  assert.equal(noOwner.calls.length, 2);
  const outage = scripted([json({}, 503)]);
  assert.equal((await checkFirstPartySession(outage.request, true)).state, 'unavailable');
  assert.deepEqual(outage.calls, ['/api/session/status']);
  const boot = scripted([json({ authenticated: false }), json({}, 401), json({ authenticated: true })]);
  assert.equal((await checkFirstPartySession(boot.request, true)).state, 'authenticated');
  assert.equal(boot.calls.at(-1), '/api/session/bootstrap');
});
