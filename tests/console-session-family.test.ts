import assert from 'node:assert/strict';
import test from 'node:test';
import { issueSession, authorizeSession, rotateSession, revokeSession, ACCESS_LIFETIME_MS, SESSION_LIFETIME_MS, CONCURRENT_REFRESH_MS, type SessionState } from '../apps/console/session-family.ts';
import { transactSession, parseSessionState, createSessionStore, type SessionStore } from '../apps/console/session-store.ts';

const owner = '123', key = 'synthetic-test-key', now = 1_800_000_000_000;
const bootstrap = 'a'.repeat(43);
const empty: SessionState = { families: [] };
const issue = () => {
  const result = issueSession(empty, owner, owner, bootstrap, now, now, key);
  assert.equal(result.outcome, 'issued');
  if (result.outcome !== 'issued') throw new Error('fixture failed');
  return result;
};

test('owner-only one-use bootstrap, opaque credentials and absolute expiry', () => {
  const issued = issue();
  assert.equal(issueSession(empty, '456', owner, bootstrap, now, now, key).outcome, 'denied');
  assert.equal(issueSession(issued.state, owner, owner, bootstrap, now, now, key).outcome, 'denied');
  assert.equal(issueSession(empty, owner, owner, bootstrap, now, now + SESSION_LIFETIME_MS, key).outcome, 'denied');
  assert.equal(authorizeSession(issued.state, issued.credentials.access, owner, now, key), true);
  assert.equal(authorizeSession(issued.state, issued.credentials.refresh, owner, now, key), false);
  assert.equal(authorizeSession(issued.state, issued.credentials.access, '456', now, key), false);
  assert.equal(authorizeSession(issued.state, issued.credentials.access, owner, now + ACCESS_LIFETIME_MS, key), false);
  const stored = JSON.stringify(issued.state);
  for (const credential of [bootstrap, issued.credentials.access, issued.credentials.refresh]) assert.equal(stored.includes(credential), false);
});

test('refresh rotates once, rejects early refresh, and revokes on confirmed stale replay', () => {
  const issued = issue(), at = now + ACCESS_LIFETIME_MS;
  assert.equal(rotateSession(issued.state, issued.credentials.refresh, owner, now, key).outcome, 'too-early');
  const rotated = rotateSession(issued.state, issued.credentials.refresh, owner, at, key);
  if (rotated.outcome !== 'rotated') throw new Error('fixture failed');
  assert.equal(rotated.credentials.expiresAt, now + SESSION_LIFETIME_MS);
  assert.equal(authorizeSession(rotated.state, issued.credentials.access, owner, at, key), false);
  assert.equal(authorizeSession(rotated.state, rotated.credentials.access, owner, at, key), true);
  assert.equal(rotateSession(rotated.state, issued.credentials.refresh, owner, at + 1, key).outcome, 'conflict');
  const replay = rotateSession(rotated.state, issued.credentials.refresh, owner, at + CONCURRENT_REFRESH_MS + 1, key);
  assert.equal(replay.outcome, 'revoked');
  assert.equal(authorizeSession(replay.state, rotated.credentials.access, owner, at + CONCURRENT_REFRESH_MS + 1, key), false);
  assert.equal(rotateSession(rotated.state, rotated.credentials.refresh, owner, now + SESSION_LIFETIME_MS, key).outcome, 'denied');
});

test('logout revokes the family and cannot restore bootstrap eligibility', () => {
  const issued = issue();
  const revoked = revokeSession(issued.state, issued.credentials.refresh, owner, now, key);
  assert.equal(revoked.outcome, 'revoked');
  assert.equal(authorizeSession(revoked.state, issued.credentials.access, owner, now, key), false);
  assert.equal(rotateSession(revoked.state, issued.credentials.refresh, owner, now, key).outcome, 'denied');
  assert.equal(issueSession(revoked.state, owner, owner, bootstrap, now, now, key).outcome, 'denied');
});

test('logout racing a successful refresh still revokes the same family', () => {
  const issued = issue();
  const rotated = rotateSession(issued.state, issued.credentials.refresh, owner, now + ACCESS_LIFETIME_MS, key);
  if (rotated.outcome !== 'rotated') throw new Error('fixture failed');
  const revoked = revokeSession(rotated.state, issued.credentials.refresh, owner, now + ACCESS_LIFETIME_MS + 1, key);
  assert.equal(revoked.outcome, 'revoked');
  assert.equal(authorizeSession(revoked.state, rotated.credentials.access, owner, now + ACCESS_LIFETIME_MS + 1, key), false);
});

test('active family capacity refuses new sessions without evicting existing families', () => {
  let state = empty;
  for (let i = 0; i < 8; i++) {
    const result = issueSession(state, owner, owner, String(i).repeat(43), now, now, key);
    assert.equal(result.outcome, 'issued');
    state = result.state;
  }
  assert.equal(issueSession(state, owner, owner, 'z'.repeat(43), now, now, key).outcome, 'capacity');
  assert.equal(state.families.length, 8);
});

test('atomic transaction retries produce exactly one issued and one rotated credential pair', async () => {
  let raw: string | null = null;
  const store: SessionStore = { async read() { return raw; }, async compareAndSet(expected, next) { if (raw !== expected) return false; raw = next; return true; } };
  const results = await Promise.all([1, 2].map(() => transactSession(store, owner, state => issueSession(state, owner, owner, bootstrap, now, now, key))));
  const issued = results.find(r => r.outcome === 'issued');
  assert.equal(results.filter(r => r.outcome === 'issued').length, 1);
  if (!issued || issued.outcome !== 'issued') throw new Error('fixture failed');
  const rotations = await Promise.all([1, 2].map(() => transactSession(store, owner, state => rotateSession(state, issued.credentials.refresh, owner, now + ACCESS_LIFETIME_MS, key))));
  assert.deepEqual(rotations.map(r => r.outcome).sort(), ['conflict', 'rotated']);
});

test('store failures and malformed persisted records fail closed', async () => {
  assert.throws(() => parseSessionState('invalid', owner), /Session state unavailable/);
  assert.throws(() => parseSessionState(JSON.stringify(issue().state), '456'), /Session state unavailable/);
  const store: SessionStore = { async read() { throw new Error('unavailable'); }, async compareAndSet() { return true; } };
  await assert.rejects(() => transactSession(store, owner, state => issueSession(state, owner, owner, bootstrap, now, now, key)), /unavailable/);
  const unavailable = createSessionStore({ url: 'https://test.upstash.io', token: 'synthetic' }, owner, async () => new Response('', { status: 503 }));
  await assert.rejects(() => unavailable.read(), /Session store unavailable/);
});

test('storage TTL never extends beyond the latest family absolute expiry', async () => {
  const issued = issue();
  const remaining = SESSION_LIFETIME_MS - ACCESS_LIFETIME_MS;
  let command: unknown[] | undefined;
  const store = createSessionStore({ url: 'https://test.upstash.io', token: 'synthetic' }, owner, async (_url, init) => {
    command = JSON.parse(String(init?.body))[0] as unknown[];
    return new Response(JSON.stringify([{ result: 1 }]), { headers: { 'Content-Type': 'application/json' } });
  }, () => now + ACCESS_LIFETIME_MS);
  assert.equal(await store.compareAndSet(null, JSON.stringify(issued.state)), true);
  assert.equal(command?.at(-1), remaining);
  assert.equal(JSON.stringify(command).includes(issued.credentials.access), false);
});
