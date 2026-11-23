import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { githubApi, reactToComment, route, validSignature } from '../src/webhook.ts';

const repo = { id: 7, full_name: 'Oddmash/new-project', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
const event = { action: 'opened', installation: { id: 3 }, repository: repo, pull_request: { number: 2, draft: false } };
test('new public organization repositories are eligible', () => {
  assert.deepEqual(route('pull_request', event), { installation: 3, repository: repo.full_name, repositoryId: 7, number: 2 });
});
test('unapproved private, external, draft, archived and unrelated events are ignored', () => {
  for (const repository of [{ ...repo, private: true }, { ...repo, visibility: 'internal' }, { ...repo, owner: { login: 'Other' } }, { ...repo, archived: true }]) assert.equal(route('pull_request', { ...event, repository }), null);
  assert.equal(route('pull_request', { ...event, pull_request: { number: 2, draft: true } }), null);
  assert.equal(route('pull_request', { ...event, action: 'closed' }), null);
  assert.equal(route('push', event), null);
});
test('only completed valid check suites trigger', () => {
  const sha = 'a'.repeat(40);
  assert.equal(route('check_suite', { ...event, action: 'completed', check_suite: { head_sha: sha } })?.sha, sha);
  assert.equal(route('check_suite', { ...event, action: 'requested', check_suite: { head_sha: sha } }), null);
});
test('signature authenticates exact bytes', () => {
  const data = Buffer.from('{"hello":1}');
  const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(data).digest('hex');
  assert.equal(validSignature(data, signature, 'test-secret'), true);
  assert.equal(validSignature(Buffer.from('different'), signature, 'test-secret'), false);
  assert.equal(validSignature(data, signature, ''), false);
  assert.equal(validSignature(data, null, 'test-secret'), false);
});

test('maintainer can request a fresh review or mention the bot in its inline thread', () => {
  const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
  const slug = 'oddmash-reviewer';
  const delivery = '11111111-2222-3333-4444-555555555555';
  const requested = { ...event, action: 'review_requested', sender: actor, requested_reviewer: { id: 9, login: `${slug}[bot]`, type: 'Bot' } };
  assert.equal(route('pull_request', requested, slug, delivery)?.recheck, delivery);
  assert.equal(route('pull_request', { ...requested, sender: { ...actor, id: 10 } }, slug, delivery), null);
  const comment = { ...event, action: 'created', sender: actor, comment: { id: 5, user: actor, body: `@${slug} /review` }, issue: { number: 2, pull_request: {} } };
  assert.equal(route('issue_comment', comment, slug)?.recheck, 'comment-5');
  assert.deepEqual(route('issue_comment', comment, slug)?.requestComment, { kind: 'issue', id: 5 });
  assert.equal(route('issue_comment', { ...comment, comment: { ...comment.comment, body: `@${slug}` } }, slug)?.recheck, 'comment-5');
  assert.equal(route('issue_comment', { ...comment, issue: { number: 2 } }, slug), null);
  const reply = { ...comment, comment: { ...comment.comment, body: `@${slug}[bot] Is this required?`, in_reply_to_id: 4 } };
  assert.deepEqual(route('pull_request_review_comment', reply, slug)?.reply, { comment: 5, root: 4 });
  assert.equal(route('pull_request_review_comment', { ...reply, sender: { ...actor, type: 'Bot' } }, slug), null);
  assert.equal(route('pull_request_review_comment', { ...reply, action: 'edited' }, slug), null);
  assert.equal(route('pull_request_review_comment', { ...reply, comment: { ...reply.comment, body: '@other is this required?' } }, slug), null);
});

test('adds reactions to the exact comment type and uses only supported statuses', async () => {
  const calls: [string, string][] = [];
  const api = githubApi('fixture', async (url, init) => { calls.push([new URL(String(url)).pathname, JSON.parse(String(init?.body)).content]); return Response.json({ id: 1 }); });
  await reactToComment(api, repo.full_name, { kind: 'issue', id: 123 }, 'eyes');
  await reactToComment(api, repo.full_name, { kind: 'inline', id: 456 }, '+1');
  assert.deepEqual(calls, [[`/repos/${repo.full_name}/issues/comments/123/reactions`, 'eyes'], [`/repos/${repo.full_name}/pulls/comments/456/reactions`, '+1']]);
});

test('only explicitly approved private repository identities are eligible', () => {
  for (const [name, id] of Object.entries({ 'Oddmash/oddmash-agents': 1468182609, 'Oddmash/oddmash-skills': 1468154482, 'Oddmash/overtime-prototype': 1461455091, 'Oddmash/cash-out': 1462488077 })) {
    const repository = { ...repo, full_name: name, id, private: true, visibility: 'private' };
    assert.deepEqual(route('pull_request', { ...event, repository }), { installation: 3, repository: name, repositoryId: id, private: true, number: 2 });
    assert.equal(route('pull_request', { ...event, repository: { ...repository, id: 99 } }), null);
    assert.equal(route('pull_request', { ...event, repository: { ...repository, visibility: 'internal' } }), null);
    assert.equal(route('pull_request', { ...event, repository: { ...repository, archived: true } }), null);
  }
  assert.equal(route('pull_request', { ...event, repository: { ...repo, private: true, visibility: 'private' } }), null);
});
