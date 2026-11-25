import assert from 'node:assert/strict';
import test from 'node:test';
import { githubRequest, trackGitHubRequests } from '../apps/worker/src/github-request.ts';

test('retries a rate-limited read only once', async () => {
  let calls = 0;
  const delays: number[] = [];
  const response = await githubRequest(async () => {
    calls++;
    return new Response(null, { status: 403, headers: { 'retry-after': '1' } });
  }, '/repos/Oddmash/.github/contents/AGENTS.md?ref=main', {}, false, async ms => { delays.push(ms); });
  assert.equal(response.status, 403);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
});

test('does not retry permanent denial, long waits, exhausted quota or writes', async () => {
  const cases: [number, HeadersInit, string][] = [
    [403, {}, 'GET'], [429, { 'retry-after': '60' }, 'GET'],
    [403, { 'retry-after': '1', 'x-ratelimit-remaining': '0' }, 'GET'],
    [503, {}, 'POST'], [500, {}, 'POST'], [500, { 'x-ratelimit-remaining': '0' }, 'GET']
  ];
  for (const [status, headers, method] of cases) {
    let calls = 0;
    const response = await githubRequest(async () => { calls++; return new Response(null, { status, headers }); }, '/repos/Oddmash/example/pulls/1', { method }, false, async () => assert.fail('unexpected retry'));
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
});

test('recovers from transient read failure', async () => {
  let calls = 0;
  const response = await githubRequest(async () => new Response(null, { status: ++calls === 1 ? 503 : 200 }), '/repos/Oddmash/example/pulls/1/files', {}, false, async () => {});
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('retries GitHub 500 check-run reads once and no more', async () => {
  for (const recovered of [true, false]) {
    let calls = 0;
    const delays: number[] = [];
    const response = await githubRequest(async () => new Response(null, {
      status: ++calls === 2 && recovered ? 200 : 500
    }), '/repos/Oddmash/example/commits/fixture/check-runs', {}, false, async ms => { delays.push(ms); });
    assert.equal(response.status, recovered ? 200 : 500);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [250]);
  }
});

test('honors short retry-after and aborts before the second GET 500 attempt', async () => {
  const controller = new AbortController();
  let calls = 0;
  const delays: number[] = [];
  const response = await githubRequest(async () => {
    calls++;
    return new Response(null, { status: 500, headers: { 'retry-after': '1' } });
  }, '/repos/Oddmash/example/commits/fixture/check-runs', { signal: controller.signal }, false, async ms => {
    delays.push(ms);
    controller.abort();
  });
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
  assert.deepEqual(delays, [1000]);
});

test('logs only numeric quota metadata and classified request context', async t => {
  const messages: string[] = [];
  t.mock.method(console, 'warn', (message: string) => { messages.push(message); });
  const response = await githubRequest(async () => new Response('fixture-response-body', {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000', 'retry-after': 'fixture-untrusted-header' }
  }), '/repos/Oddmash/.github/contents/fixture-path?ref=fixture-ref', { headers: { Authorization: 'Bearer fixture-token' } });
  assert.equal(response.status, 403);
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(messages[0]), {
    event: 'github_request_failed', category: 'organization-guidance', status: 403,
    attempt: 1, read: true, authenticated: true, failure: 'primary-rate-limit',
    remaining: 0, reset: 1800000000
  });
  assert.doesNotMatch(messages[0], /fixture/);
});

test('aggregates bounded request dimensions separately across concurrent executions', async () => {
  const summaries: unknown[][] = [];
  const path = '/repos/Oddmash/.github/contents/fixture-path?ref=fixture-ref';
  const first = trackGitHubRequests(async () => {
    let calls = 0;
    await githubRequest(async () => new Response(null, { status: ++calls === 1 ? 503 : 200 }), path, { headers: { Authorization: 'Bearer fixture-token' } }, false, async () => {});
    await githubRequest(async () => new Response(null, { status: 304 }), path, { headers: { Authorization: 'Bearer fixture-token', 'If-None-Match': 'fixture-etag' } });
  }, counts => { summaries[0] = counts; });
  const second = trackGitHubRequests(async () => {
    await githubRequest(async () => new Response(null, { status: 200 }), path, {});
  }, counts => { summaries[1] = counts; });
  await Promise.all([first, second]);
  const all = JSON.stringify(summaries);
  assert.doesNotMatch(all, /fixture/);
  assert.deepEqual(summaries[0], [
    { category: 'organization-guidance', authenticated: true, read: true, outcome: 'http-error', count: 1, retries: 0 },
    { category: 'organization-guidance', authenticated: true, read: true, outcome: 'not-modified', count: 1, retries: 0 },
    { category: 'organization-guidance', authenticated: true, read: true, outcome: 'success', count: 1, retries: 1 }
  ]);
  assert.deepEqual(summaries[1], [{ category: 'organization-guidance', authenticated: false, read: true, outcome: 'success', count: 1, retries: 0 }]);
});
