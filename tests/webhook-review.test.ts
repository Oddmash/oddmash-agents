import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquirePendingReview, existingAdvisoryReview, reviewFingerprint } from '../src/webhook-review.ts';
import { githubApi } from '../src/webhook.ts';

const path = '/repos/Oddmash/example/pulls/1';
const bot = 'oddmash-reviewer[bot]';
const head = 'a'.repeat(40);

test('finds the existing bot advisory to update instead of submitting a duplicate', () => {
  const old = { id: 1, state: 'COMMENTED', user: { login: bot }, commit_id: head, body: '<!-- oddmash-app-review:old -->\nMaintainer review required.' };
  const checks = { total_count: 1, check_runs: [{ id: 2, name: 'verify', status: 'completed', conclusion: 'success' }] };
  assert.notEqual(old.body, reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks));
  assert.equal(existingAdvisoryReview([old, { ...old, id: 2, user: { login: 'someone' } }, { ...old, id: 3, commit_id: 'c'.repeat(40) }], bot, head)?.id, 1);
  assert.equal(existingAdvisoryReview([{ ...old, state: 'APPROVED' }], bot, head), undefined);
});

test('acquires only its own pending review lock', async () => {
  const api = githubApi('fixture-token', async () => Response.json({ id: 42, state: 'PENDING', user: { login: bot }, commit_id: head }));
  assert.equal(await acquirePendingReview(api, path, head, bot), 42);
});

test('does not acquire a concurrent pending review', async () => {
  const api = githubApi('fixture-token', async (_url, init) => init?.method === 'POST' ? new Response(null, { status: 422 }) : Response.json([{ id: 42, state: 'PENDING', user: { login: bot }, commit_id: head }]));
  assert.equal(await acquirePendingReview(api, path, head, bot), null);
});

test('does not hide unrelated validation errors', async () => {
  const api = githubApi('fixture-token', async (_url, init) => init?.method === 'POST' ? new Response(null, { status: 422 }) : Response.json([]));
  await assert.rejects(acquirePendingReview(api, path, head, bot), /\(422\)/);
});
