import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquirePendingReview } from '../src/webhook-review.ts';
import { githubApi } from '../src/webhook.ts';

const path = '/repos/Oddmash/example/pulls/1';
const bot = 'oddmash-reviewer[bot]';
const head = 'a'.repeat(40);

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
