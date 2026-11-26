import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionHttp } from '../apps/console/session-http.ts';
import { ACCESS_LIFETIME_MS } from '../apps/console/session-family.ts';
import type { SessionStore } from '../apps/console/session-store.ts';

const origin = 'https://console.example', ownerId = '123', start = 1_800_000_000_000;
const req = (method: string, cookie = '', source = origin) => new Request(origin + '/api/session', { method, headers: { origin: source, cookie, 'content-type': 'application/json' } });
const jar = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const fixture = () => {
  let raw: string | null = null, now = start, unavailable = false;
  const store: SessionStore = { async read() { if (unavailable) throw new Error('unavailable'); return raw; }, async compareAndSet(expected, next) { if (raw !== expected) return false; raw = next; return true; } };
  const http = createSessionHttp({ store, ownerId, origin, key: 'synthetic-test-key', now: () => now });
  return { http, advance: (ms: number) => { now += ms; }, fail: () => { unavailable = true; } };
};
const verified = { ownerId, nonce: 'a'.repeat(43), signedInAt: start };

test('opaque session cookies are host-only, secure, HttpOnly and absent from JSON', async () => {
  const { http } = fixture();
  assert.equal((await http.bootstrap(req('POST', '', 'https://other.example'), verified)).status, 403);
  assert.equal((await http.bootstrap(req('POST'), { ...verified, ownerId: '456' })).status, 401);
  assert.equal((await http.bootstrap(req('POST'), undefined)).status, 401);
  const issued = await http.bootstrap(req('POST'), verified);
  assert.equal(issued.status, 200);
  assert.deepEqual(await issued.json(), { authenticated: true });
  for (const value of issued.headers.getSetCookie()) {
    assert.match(value, /^__Host-oddmash-/);
    assert.match(value, /; Path=\/; Secure; HttpOnly; SameSite=Strict;/);
    assert.doesNotMatch(value, /Domain=/);
  }
  assert.equal(issued.headers.getSetCookie().length, 2);
  assert.equal(await http.accessAuthorized(req('GET', jar(issued))), true);
  assert.equal(await http.accessAuthorized(req('GET')), false);
  assert.equal((await http.bootstrap(req('POST'), verified)).status, 401);
});

test('only one refresh wins, logout invalidates access, and cross-origin writes are rejected', async () => {
  const { http, advance } = fixture();
  const initial = jar(await http.bootstrap(req('POST'), verified));
  advance(ACCESS_LIFETIME_MS);
  assert.equal(await http.accessAuthorized(req('GET', initial)), false);
  assert.equal((await http.refresh(req('POST', initial, 'https://other.example'))).status, 403);
  const [a, b] = await Promise.all([http.refresh(req('POST', initial)), http.refresh(req('POST', initial))]);
  const winner = a.status === 200 ? a : b, loser = a.status === 200 ? b : a;
  assert.equal(winner.status, 200);
  assert.equal(loser.status, 409);
  assert.equal(loser.headers.getSetCookie().length, 0);
  const rotated = jar(winner);
  assert.equal((await http.logout(req('POST', rotated, 'https://other.example'))).status, 403);
  const loggedOut = await http.logout(req('POST', rotated));
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.headers.getSetCookie().every(value => value.includes('Max-Age=0')), true);
  assert.equal(await http.accessAuthorized(req('GET', rotated)), false);
  assert.equal((await http.refresh(req('POST', rotated))).status, 401);
});

test('unavailable storage denies session status and failed logout clears only browser access for retry', async () => {
  const { http, fail } = fixture();
  const initial = jar(await http.bootstrap(req('POST'), verified));
  fail();
  assert.equal((await http.status(req('GET', initial))).status, 503);
  const logout = await http.logout(req('POST', initial));
  assert.equal(logout.status, 503);
  assert.equal(logout.headers.getSetCookie().length, 1);
  assert.match(logout.headers.getSetCookie()[0], /__Host-oddmash-access=;/);
});
