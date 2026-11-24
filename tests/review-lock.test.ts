import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acquirePendingReview, withPendingReviewLock, type Review } from '../src/review-lock.ts';
import { githubApi } from '../src/webhook.ts';

const path = '/repos/Oddmash/example/pulls/1';
const head = 'a'.repeat(40);
const bot = 'oddmash-lead[bot]';
const earlierReviews: Review[] = Array.from({ length: 100 }, (_, index) => ({
  id: index + 1, state: 'APPROVED', user: { login: bot }, commit_id: head, body: 'An earlier completed review'
}));
const expired: Review = {
  id: 101, state: 'PENDING', user: { login: bot }, commit_id: head,
  body: '<!-- oddmash-review-lock -->\n<!-- oddmash-webhook-lock:' + (Date.now() - 361_000) + ' -->'
};

test('discussion recovers an expired lock after the first page of reviews', async () => {
  const events: string[] = [];
  let pending: Review | undefined = expired;
  const api = githubApi('fixture', async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === path + '/reviews' && method === 'GET') {
      const page = url.searchParams.get('page');
      assert.equal(url.searchParams.get('per_page'), '100');
      if (page === '1') return Response.json(earlierReviews);
      assert.equal(page, '2');
      return Response.json(pending ? [pending] : []);
    }
    if (url.pathname === path + '/reviews' && method === 'POST') {
      assert.equal(pending, undefined);
      pending = { ...expired, ...JSON.parse(String(init?.body)), id: 102 };
      events.push('acquired 102');
      return Response.json(pending);
    }
    assert.ok(pending);
    assert.equal(url.pathname, path + '/reviews/' + pending.id);
    if (method === 'GET') return Response.json(pending);
    assert.equal(method, 'DELETE');
    events.push('deleted ' + pending.id);
    pending = undefined;
    return new Response(null, { status: 204 });
  });
  await withPendingReviewLock(api, path, head, bot, async () => { events.push('ran action'); });
  assert.deepEqual(events, ['deleted 101', 'acquired 102', 'ran action', 'deleted 102']);
});

test('a concurrent lock returned as 422 can be found on another review page', async () => {
  const oldHead = 'b'.repeat(40);
  const api = githubApi('fixture', async (input, init) => {
    if (init?.method === 'POST') return new Response(null, { status: 422 });
    const page = new URL(String(input)).searchParams.get('page');
    if (page === '1') return Response.json(earlierReviews);
    assert.equal(page, '2');
    return Response.json([expired]);
  });
  assert.equal(await acquirePendingReview(api, path, oldHead, bot, true), null);
});

test('discussion refuses to write if the review pagination budget is exhausted', async () => {
  const pages: string[] = [];
  const api = githubApi('fixture', async (input, init) => {
    assert.equal(init?.method, undefined);
    pages.push(new URL(String(input)).searchParams.get('page')!);
    return Response.json(earlierReviews);
  });
  await assert.rejects(withPendingReviewLock(api, path, head, bot, async () => {
    assert.fail('The action ran without complete review coverage');
  }), /Pending review lookup incomplete/);
  assert.deepEqual(pages, Array.from({ length: 10 }, (_, index) => String(index + 1)));
});
