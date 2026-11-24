import test from 'node:test';
import assert from 'node:assert/strict';
import { githubApi, route, impactCommand } from '../src/webhook.ts';
import { runImpact, validImpact, impactBody } from '../src/impact.ts';

const bot = 'oddmash-reviewer[bot]';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
const repo = { id: 42, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
const payload = { action: 'created', installation: { id: 1 }, repository: repo, sender: actor, issue: { number: 7, pull_request: {} }, comment: { id: 9, user: actor, body: '@oddmash-reviewer[bot] /impact' } };
const target = route('issue_comment', payload, 'oddmash-reviewer')!;
const language = { benefit: 'Clearer usage', fit: 'Fits the stated issue', cost: 'Small upkeep', risk: 'Verify compatibility', evidence: 'Check behavior' };
const result = { recommendation: 'recommend', confidence: 'medium', en: language, ko: language } as const;

test('only maintainer conversation command routes to impact, not review or automatic merge', () => {
  assert.equal(impactCommand(payload.comment.body, 'oddmash-reviewer'), true);
  assert.equal(target.impact, true);
  assert.equal(target.recheck, undefined);
  assert.equal(route('issue_comment', { ...payload, sender: { ...actor, id: 2 } }, 'oddmash-reviewer'), null);
  assert.equal(route('issue_comment', { ...payload, comment: { ...payload.comment, body: '@oddmash-reviewer[bot] /impact now' } }, 'oddmash-reviewer'), null);
  assert.equal(route('issue_comment', { ...payload, comment: { ...payload.comment, body: '@oddmash-reviewer[bot] /review' } }, 'oddmash-reviewer')?.impact, undefined);
});

test('validation and incomplete evidence prevent a definitive recommendation', () => {
  assert.equal(validImpact(result), true);
  assert.equal(validImpact({ ...result, en: { ...language, risk: '<script>' } }), false);
  assert.match(impactBody(result, head, base, 1), /Insufficient evidence/);
  assert.match(impactBody(result, head, base, 0), /Advisory only/);
});

test('impact posts one advisory, deduplicates, and does not approve or merge', async () => {
  const comments: { id: number; body: string; user: { login: string } }[] = [];
  const writes: string[] = [];
  const api = githubApi('fixture', async (input, init) => {
    const url = String(input);
    if (url.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
    if (url.includes('/files?')) return Response.json([{ filename: 'src/example.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]);
    if (url.includes('/comments')) {
      if (init?.method === 'POST') { writes.push(url); comments.push({ id: 10, body: JSON.parse(String(init.body)).body, user: { login: bot } }); return Response.json(comments[0]); }
      return Response.json(comments);
    }
    return Response.json({ title: 'Improve UX', body: 'Improve the example', state: 'open', draft: false, changed_files: 1, head: { sha: head }, base: { sha: base, repo: { id: repo.id, full_name: repo.full_name, private: false } } });
  });
  let modelCalls = 0;
  const request: typeof fetch = async (_input, init) => { modelCalls++; assert.equal(JSON.parse(String(init?.body)).store, false); return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }); };
  await runImpact(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  await runImpact(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.equal(modelCalls, 1);
  assert.equal(writes.length, 1);
  assert.match(comments[0].body, /Oddmash Impact/);
  assert.ok(writes.every(url => !url.includes('/merge') && !url.includes('/reviews')));
});
