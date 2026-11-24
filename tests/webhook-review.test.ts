import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { acquirePendingReview, attachReviewFindings, attachReviewFindingsWithCoverage, canRetryApprovedMerge, existingAdvisoryReview, hasOfficialReview, reviewFingerprint, expiredWebhookLock, ownsPendingReview, reviewWebhook } from '../src/webhook-review.ts';
import { githubApi } from '../src/webhook.ts';

const path = '/repos/Oddmash/example/pulls/1';
const bot = 'oddmash-reviewer[bot]';
const head = 'a'.repeat(40);

test('concurrent eligible PR deliveries waiting on CI create one queued check without submitting a review', { timeout: 10000 }, async t => {
  const previousProgress = process.env.REVIEWER_CHECK_PROGRESS_ENABLED;
  const previousQueue = process.env.REVIEWER_QUEUE_ENABLED;
  const previousApp = process.env.REVIEWER_APP_ID;
  process.env.REVIEWER_CHECK_PROGRESS_ENABLED = 'true';
  process.env.REVIEWER_QUEUE_ENABLED = 'false';
  process.env.REVIEWER_APP_ID = '42';
  t.after(() => {
    for (const [key, value] of Object.entries({ REVIEWER_CHECK_PROGRESS_ENABLED: previousProgress, REVIEWER_QUEUE_ENABLED: previousQueue, REVIEWER_APP_ID: previousApp })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const repository = { id: 7, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
  const pr = { number: 1, state: 'open', draft: false, user: { login: 'fixture', id: 10 }, head: { sha: head }, base: { sha: 'b'.repeat(40), repo: repository }, labels: [] };
  const pending = new Map<number, Record<string, unknown>>();
  let nextId = 42;
  let release!: () => void;
  const bothLocks = new Promise<void>(resolve => { release = resolve; });
  let check: Record<string, unknown> | undefined;
  let creations = 0;
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const endpoint = url.pathname;
    assert.equal(url.origin, 'https://api.github.com');
    if (endpoint === '/app/installations/3') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
    if (endpoint === '/app/installations/3/access_tokens') return Response.json({ token: 'fixture' });
    if (endpoint === '/repos/Oddmash/example') return Response.json(repository);
    if (endpoint === path) return Response.json(pr);
    if (endpoint === `${path}/reviews` && init?.method === 'POST') {
      const id = nextId++;
      const lock = { ...JSON.parse(String(init.body)), id, state: 'PENDING', user: { login: bot } };
      pending.set(id, lock);
      if (nextId === 44) release();
      await bothLocks;
      return Response.json(lock);
    }
    if (endpoint === `${path}/reviews`) return Response.json([...pending.values()]);
    if (endpoint.startsWith(`${path}/reviews/`)) {
      const id = Number(endpoint.split('/').at(-1));
      if (init?.method === 'DELETE') { pending.delete(id); return new Response(null, { status: 204 }); }
      return Response.json(pending.get(id));
    }
    if (endpoint === `/repos/Oddmash/example/commits/${head}/check-runs`) {
      if (url.searchParams.has('check_name')) return Response.json({ total_count: check ? 1 : 0, check_runs: check ? [check] : [] });
      return Response.json({ total_count: check ? 2 : 1, check_runs: [{ name: 'verify', status: 'in_progress', conclusion: null, app: { id: 15368 } }, ...(check ? [check] : [])] });
    }
    if (endpoint === '/repos/Oddmash/example/check-runs' && init?.method === 'POST') {
      ++creations;
      check = { ...JSON.parse(String(init.body)), id: 99, app: { id: 42 } };
      return Response.json(check);
    }
    if (endpoint === '/repos/Oddmash/example/check-runs/99' && init?.method === 'PATCH') {
      check = { ...check, ...JSON.parse(String(init.body)) };
      return Response.json(check);
    }
    assert.fail(`Unexpected request: ${endpoint}`);
  });
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const target = { installation: 3, repository: repository.full_name, repositoryId: repository.id, number: 1, expectedHead: head };
  const config = { appId: '42', key, slug: 'oddmash-reviewer', openaiKey: 'fixture', model: 'fixture' };
  await Promise.all([reviewWebhook(target, config), reviewWebhook(target, config)]);
  assert.equal(nextId, 44);
  await reviewWebhook(target, config);
  assert.equal(creations, 1);
  assert.equal(pending.size, 0);
  assert.equal(check?.status, 'queued');
  assert.equal((check?.output as { title: string }).title, 'Waiting for CI');
});

test('only expired webhook locks owned by the bot are eligible for recovery', () => {
  const now = 1_800_000_000_000;
  const body = `<!-- oddmash-review-lock -->\n<!-- oddmash-webhook-lock:${now - 361_000} -->`;
  const review = { id: 1, state: 'PENDING', user: { login: bot }, commit_id: head, body };
  assert.equal(expiredWebhookLock(review, bot, now), true);
  assert.equal(expiredWebhookLock(review, bot, now - 10_000), false);
  assert.equal(expiredWebhookLock({ ...review, user: { login: 'other' } }, bot, now), false);
  assert.equal(expiredWebhookLock({ ...review, state: 'APPROVED' }, bot, now), false);
  assert.equal(expiredWebhookLock({ ...review, body: '<!-- oddmash-review-lock -->' }, bot, now), false);
});

test('finds the existing bot advisory to update instead of submitting a duplicate', () => {
  const old = { id: 1, state: 'COMMENTED', user: { login: bot }, commit_id: head, body: '<!-- oddmash-app-review:old -->\nMaintainer review required.' };
  const checks = { total_count: 1, check_runs: [{ id: 2, name: 'verify', status: 'completed', conclusion: 'success' }] };
  assert.notEqual(old.body, reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks));
  assert.equal(existingAdvisoryReview([old, { ...old, id: 2, user: { login: 'someone' } }, { ...old, id: 3, commit_id: 'c'.repeat(40) }], bot, head)?.id, 1);
  assert.equal(existingAdvisoryReview([{ ...old, state: 'APPROVED' }], bot, head), undefined);
  const marker = reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks);
  assert.equal(canRetryApprovedMerge({ ...old, state: 'APPROVED' }, marker), true);
  assert.equal(canRetryApprovedMerge({ ...old, state: 'APPROVED', body: marker }, marker), false);
  assert.equal(canRetryApprovedMerge(old, marker), false);
  assert.notEqual(marker, reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks, 'comment-123'));
  assert.equal(reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks, 'comment-123'), reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks, 'comment-123'));
});

test('acquires only its own pending review lock', async () => {
  const api = githubApi('fixture-token', async () => Response.json({ id: 42, state: 'PENDING', user: { login: bot }, commit_id: head }));
  assert.equal(await acquirePendingReview(api, path, head, bot), 42);
});

test('a submitted official review deduplicates only the current head', () => {
  const review = { id: 42, state: 'CHANGES_REQUESTED', user: { login: bot }, body: '<!-- oddmash-app-review:fixture -->', commit_id: 'b'.repeat(40) };
  assert.equal(hasOfficialReview([review], bot, review.commit_id), true);
  assert.equal(hasOfficialReview([review], bot, 'd'.repeat(40)), false);
  assert.equal(hasOfficialReview([{ ...review, state: 'DISMISSED' }], bot), true);
  assert.equal(hasOfficialReview([{ ...review, state: 'PENDING' }], bot), false);
  assert.equal(hasOfficialReview([{ ...review, user: { login: 'another-reviewer' } }], bot), false);
  assert.equal(hasOfficialReview([{ ...review, body: 'unrelated comment' }], bot), false);
});

test('does not acquire a concurrent pending review', async () => {
  const api = githubApi('fixture-token', async (_url, init) => init?.method === 'POST' ? new Response(null, { status: 422 }) : Response.json([{ id: 42, state: 'PENDING', user: { login: bot }, commit_id: head }]));
  assert.equal(await acquirePendingReview(api, path, head, bot), null);
});

test('does not hide unrelated validation errors', async () => {
  const api = githubApi('fixture-token', async (_url, init) => init?.method === 'POST' ? new Response(null, { status: 422 }) : Response.json([]));
  await assert.rejects(acquirePendingReview(api, path, head, bot), /\(422\)/);
});

test('attaches all new findings to the same pending review in one mutation', async () => {
  const findings = ['a', 'b', 'c'].map((id, index) => ({ path: 'src/ui.ts', line: index + 1, side: 'RIGHT' as const, body: `<!-- oddmash-finding:${id.repeat(24)} -->\nFinding` }));
  let mutations = 0;
  const api = githubApi('fixture-token', async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === `${path}/comments`) return Response.json([{ user: { login: bot }, body: findings[0].body }]);
    if (endpoint === `${path}/reviews/42`) return Response.json({ id: 42, node_id: 'PRR_fixture', state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
    assert.equal(endpoint, '/graphql');
    mutations++;
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(Object.values(payload.variables).map(value => (value as { pullRequestReviewId: string }).pullRequestReviewId), ['PRR_fixture', 'PRR_fixture']);
    assert.deepEqual(Object.values(payload.variables).map(value => (value as { line: number }).line), [2, 3]);
    return Response.json({ data: { finding0: { thread: { id: 'thread1' } }, finding1: { thread: { id: 'thread2' } } } });
  });
  assert.equal(await attachReviewFindings(api, path, 42, head, bot, findings), 2);
  assert.equal(mutations, 1);
});

test('rejects partial batch attachment before submitting the review', async () => {
  const finding = { body: `<!-- oddmash-finding:${'a'.repeat(24)} -->`, path: 'src/ui.ts', line: 1, side: 'RIGHT' as const };
  const api = githubApi('fixture-token', async url => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === `${path}/comments`) return Response.json([]);
    if (endpoint === `${path}/reviews/42`) return Response.json({ id: 42, node_id: 'PRR_fixture', state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
    assert.equal(endpoint, '/graphql');
    return Response.json({ errors: [{ message: 'fixture error' }] });
  });
  await assert.rejects(attachReviewFindings(api, path, 42, head, bot, [finding]), /could not be attached/);
});


test('only suppresses the summary when existing bot threads cover every finding', async () => {
  const finding = { body: `<!-- oddmash-finding:${'a'.repeat(24)} -->`, path: 'src/ui.ts', line: 1, side: 'RIGHT' as const };
  const api = githubApi('fixture-token', async url => {
    assert.equal(new URL(String(url)).pathname, `${path}/comments`);
    return Response.json([{ user: { login: bot }, body: finding.body }]);
  });
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [finding]), { attached: 0, covered: true });
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [{ ...finding, body: 'Missing marker' }]), { attached: 0, covered: false });
});


test('simultaneous pending reviews elect only the oldest owned lock and fail closed on incomplete evidence', () => {
  const lock = (id: number) => ({ id, state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
  const concurrent = [lock(44), lock(42)];
  assert.equal(ownsPendingReview(concurrent, bot, head, 42), true);
  assert.equal(ownsPendingReview(concurrent, bot, head, 44), false);
  assert.equal(ownsPendingReview([lock(44)], bot, head, 42), false);
  assert.equal(ownsPendingReview([lock(42), { ...lock(44), body: 'unrelated pending review' }], bot, head, 42), false);
  assert.equal(ownsPendingReview([lock(42), { ...lock(44), commit_id: 'b'.repeat(40) }], bot, head, 42), false);
  assert.equal(ownsPendingReview(Array.from({ length: 100 }, (_, i) => lock(i + 42)), bot, head, 42), false);
});
