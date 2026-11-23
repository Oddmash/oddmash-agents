import test from 'node:test';
import assert from 'node:assert/strict';
import { githubApi } from '../src/webhook.ts';
import { publishAutomationStatus, statusText } from '../src/review-status.ts';

test('status comments update in place, suppress repeats and do not disclose arbitrary errors', async () => {
  const head = 'a'.repeat(40), bot = 'oddmash-reviewer[bot]';
  const comments: { id: number; body: string; user: { login: string } }[] = [];
  let posts = 0, patches = 0;
  const api = githubApi('fixture', async (input, init) => {
    const url = String(input);
    if (url.includes('/pulls/7')) return Response.json({ state: 'open', head: { sha: head } });
    if (init?.method === 'POST') { posts++; comments.push({ id: 10, body: JSON.parse(String(init.body)).body, user: { login: bot } }); return Response.json(comments[0]); }
    if (init?.method === 'PATCH') { patches++; comments[0].body = JSON.parse(String(init.body)).body; return Response.json(comments[0]); }
    return Response.json(comments);
  });
  const publish = (reason: string, completed = false) => publishAutomationStatus(api, 'Oddmash/example', 7, bot, head, 'merge', reason, completed);
  await publish('merge completed', true);
  assert.equal(posts, 0);
  await publish('missing single closing issue link');
  await publish('missing single closing issue link');
  assert.equal(posts, 1);
  assert.equal(patches, 0);
  assert.match(comments[0].body, /Closes #N/);
  await publish('arbitrary secret-like fixture');
  assert.equal(patches, 1);
  assert.doesNotMatch(comments[0].body, /arbitrary secret-like fixture/);
  await publish('merge completed', true);
  assert.match(comments[0].body, /Automatic merge completed/);
  assert.equal(patches, 2);
  assert.match(statusText('review', 'Model quota, rate or credit limit reached; stop and check API billing before retrying')[0], /billing/);
});

test('status comments are suppressed for a stale head and never update another author', async () => {
  const bot = 'oddmash-reviewer[bot]';
  let writes = 0;
  const api = githubApi('fixture', async (input, init) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') writes++;
    if (String(input).includes('/pulls/7')) return Response.json({ state: 'open', head: { sha: 'b'.repeat(40) } });
    return Response.json([{ id: 1, user: { login: 'other' }, body: '<!-- oddmash-automation-status:merge -->' }]);
  });
  await publishAutomationStatus(api, 'Oddmash/example', 7, bot, 'a'.repeat(40), 'merge', 'candidate is not clean');
  assert.equal(writes, 0);
});
