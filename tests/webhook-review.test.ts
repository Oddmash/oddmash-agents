import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquirePendingReview, attachReviewFindings, canRetryApprovedMerge, existingAdvisoryReview, hasOfficialReview, reviewFingerprint, expiredWebhookLock } from '../src/webhook-review.ts';
import { githubApi } from '../src/webhook.ts';

const path = '/repos/Oddmash/example/pulls/1';
const bot = 'oddmash-reviewer[bot]';
const head = 'a'.repeat(40);

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

test('a submitted official review prevents automatic repeated reviews on later heads', () => {
  const review = { id: 42, state: 'CHANGES_REQUESTED', user: { login: bot }, body: '<!-- oddmash-app-review:fixture -->', commit_id: 'b'.repeat(40) };
  assert.equal(hasOfficialReview([review], bot), true);
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
