import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { assertAuthorizationQuota, createAuthorizationQuotaCooldown, githubRequest, trackGitHubRequests } from '../apps/worker/src/github-request.ts';
import { authorize } from '../apps/worker/src/webhook.ts';

const headers = { Authorization: 'Bearer fixture-only-token' };

test('classifies authorization requests without exposing repository paths or credentials', async () => {
  const counts: unknown[][] = [];
  await trackGitHubRequests(async () => {
    const request = async () => new Response(null, { status: 200 });
    await githubRequest(request, '/app', { headers });
    await githubRequest(request, '/app/installations/54321', { headers });
    await githubRequest(request, '/repos/Oddmash/fixture-private-name/installation', { headers });
    await githubRequest(request, '/app/installations/54321/access_tokens', { method: 'POST', headers });
    await githubRequest(request, '/repos/Oddmash/fixture-private-name', { headers });
    await githubRequest(request, '/installation/token', { method: 'DELETE', headers });
  }, result => counts.push(result));
  assert.deepEqual(counts[0], [
    { category: 'app-identity', authenticated: true, read: true, outcome: 'success', count: 1, retries: 0 },
    { category: 'installation-identity', authenticated: true, read: true, outcome: 'success', count: 2, retries: 0 },
    { category: 'installation-token-mint', authenticated: true, read: false, outcome: 'success', count: 1, retries: 0 },
    { category: 'installation-token-revoke', authenticated: true, read: false, outcome: 'success', count: 1, retries: 0 },
    { category: 'repository-identity', authenticated: true, read: true, outcome: 'success', count: 1, retries: 0 }
  ]);
  assert.doesNotMatch(JSON.stringify(counts), /fixture|54321/);
});

test('defers only matching authenticated authorization reads during primary quota exhaustion', async t => {
  const now = 1_800_000_000_000;
  const reset = String(now / 1000 + 60);
  const identity = { appId: '54321' };
  const cooldown = createAuthorizationQuotaCooldown(() => now);
  const messages: string[] = [];
  t.mock.method(console, 'warn', message => messages.push(message as string));
  let calls = 0;
  const request = async () => new Response(null, { status: ++calls === 1 ? 403 : 200, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } });
  const pause = async () => assert.fail('primary exhaustion must not retry');
  const options = { identity, cooldown };
  const first = await githubRequest(request, '/app/installations/54321', { headers }, false, pause, options);
  assert.equal(first.status, 403);
  let counts: unknown[] = [];
  await assert.rejects(trackGitHubRequests(() => githubRequest(request, '/repos/Oddmash/fixture-repo/installation', { headers }, false, pause, options), result => { counts = result; }), /GitHub request failed \(403\)/);
  assert.equal(calls, 1);
  assert.deepEqual(counts, [{ category: 'installation-identity', authenticated: true, read: true, outcome: 'quota-deferred', count: 1, retries: 0 }]);
  assert.deepEqual(JSON.parse(messages.at(-1)!), { event: 'github_request_deferred', category: 'installation-identity', authenticated: true, read: true, failure: 'primary-rate-limit-cooldown', reset: Number(reset) });
  assert.doesNotMatch(JSON.stringify(messages), /fixture|54321/);

  assert.equal((await githubRequest(request, '/app', { headers }, false, pause, { identity: { appId: '54322' }, cooldown })).status, 200);
  assert.equal((await githubRequest(request, '/repos/Oddmash/fixture-repo', { headers }, false, pause, { identity: { appId: identity.appId, installationId: 123 }, cooldown })).status, 200);
  assert.equal((await githubRequest(request, '/app/installations/54321', {}, false, pause, options)).status, 200);
  assert.equal((await githubRequest(request, '/repos/Oddmash/fixture-repo/pulls/1', { headers }, false, pause, options)).status, 200);
  assert.equal((await githubRequest(request, '/app/installations/54321/access_tokens', { method: 'POST', headers }, false, pause, options)).status, 200);
  assert.equal(calls, 6);
});

test('bounds reset evidence, isolates installation quotas and resumes fresh reads after reset', async () => {
  let now = 1_800_000_000_000;
  const cooldown = createAuthorizationQuotaCooldown(() => now);
  const identity = { appId: '123', installationId: 456 };
  const nowSeconds = now / 1000;
  for (const invalid of [undefined, nowSeconds, nowSeconds - 1, nowSeconds + 3606, Number.NaN, nowSeconds + 0.5]) {
    cooldown.remember(identity, invalid);
    assert.equal(cooldown.reset(identity), undefined);
  }
  let calls = 0;
  const request = async () => new Response(null, { status: ++calls === 1 ? 429 : 200, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(nowSeconds + 60) } });
  await githubRequest(request, '/repos/Oddmash/fixture-repo', { headers }, false, undefined, { identity, cooldown });
  assert.throws(() => assertAuthorizationQuota(identity, 'repository-identity', request, cooldown), /GitHub request failed \(403\)/);
  assert.doesNotThrow(() => assertAuthorizationQuota({ ...identity, installationId: 457 }, 'repository-identity', request, cooldown));
  assert.doesNotThrow(() => assertAuthorizationQuota({ appId: '123' }, 'installation-identity', request, cooldown));
  cooldown.remember(identity, nowSeconds + 30);
  assert.equal(cooldown.reset(identity), nowSeconds + 60);
  now += 60_000;
  assert.equal(cooldown.reset(identity), undefined);
  assert.equal((await githubRequest(request, '/repos/Oddmash/fixture-repo', { headers }, false, undefined, { identity, cooldown })).status, 200);
  assert.equal(calls, 2);
  for (let i = 1; i <= 33; i++) cooldown.remember({ appId: String(i) }, now / 1000 + 60);
  assert.equal(cooldown.reset({ appId: '1' }), undefined);
  assert.equal(cooldown.reset({ appId: '33' }), now / 1000 + 60);
});

test('non-primary failures and writes never establish an authorization cooldown', async () => {
  const now = 1_800_000_000_000;
  const cooldown = createAuthorizationQuotaCooldown(() => now);
  const identity = { appId: '123' };
  const reset = String(now / 1000 + 60);
  for (const [status, responseHeaders, method] of [
    [403, { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': reset }, 'GET'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'invalid' }, 'GET'],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }, 'POST']
  ] as const) {
    let calls = 0;
    const request = async () => { calls++; return new Response(null, { status, headers: responseHeaders }); };
    await githubRequest(request, '/app/installations/456', { headers, method }, false, async () => assert.fail('unexpected retry'), { identity, cooldown });
    assert.equal(cooldown.reset(identity), undefined);
    assert.equal(calls, 1);
  }
});

test('warm authorization stops before minting another token for an exhausted installation', async t => {
  const key = generateKeyPairSync('rsa', { modulusLength: 1024, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const appId = '123456789';
  const target = { installation: 5432, repository: 'Oddmash/fixture-repo', repositoryId: 987, number: 1 };
  const observed: string[] = [];
  const reset = String(Math.floor(Date.now() / 1000) + 60);
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url).pathname;
    observed.push((init?.method ?? 'GET') + ' ' + path);
    if (path === '/app/installations/5432') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
    if (path.endsWith('/access_tokens')) return Response.json({ token: 'fixture-only-token' });
    return new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } });
  });
  await assert.rejects(authorize(target, appId, key), /GitHub request failed \(403\)/);
  assert.deepEqual(observed, ['GET /app/installations/5432', 'POST /app/installations/5432/access_tokens', 'GET /repos/Oddmash/fixture-repo']);
  await assert.rejects(authorize(target, appId, key), /GitHub request failed \(403\)/);
  assert.equal(observed.length, 3);
});
