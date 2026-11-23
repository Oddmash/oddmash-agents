import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { route, validSignature } from '../src/webhook.ts';

const repo = { id: 7, full_name: 'Oddmash/new-project', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
const event = { action: 'opened', installation: { id: 3 }, repository: repo, pull_request: { number: 2, draft: false } };
test('new public organization repositories are eligible', () => {
  assert.deepEqual(route('pull_request', event), { installation: 3, repository: repo.full_name, repositoryId: 7, number: 2 });
});
test('private, external, draft, archived and unrelated events are ignored', () => {
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
