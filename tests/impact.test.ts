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

test('protected private paths are withheld and a changed head suppresses publication', async () => {
  const privateRepo = { id: 1468182609, full_name: 'Oddmash/oddmash-agents', private: true, visibility: 'private', owner: { login: 'Oddmash' } };
  const privateTarget = route('issue_comment', { ...payload, repository: privateRepo }, 'oddmash-reviewer')!;
  let reads = 0, posts = 0;
  const api = githubApi('fixture', async (input, init) => {
    const url = String(input);
    if (url.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
    if (url.includes('/files?')) return Response.json([{ filename: 'config/private.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+fixture-confidential' }]);
    if (url.includes('/comments')) { if (init?.method === 'POST') posts++; return Response.json([]); }
    reads++;
    return Response.json({ title: 'Improve UX', body: 'Improve the example', state: 'open', draft: false, changed_files: 1, head: { sha: reads === 1 ? head : 'c'.repeat(40) }, base: { sha: base, repo: privateRepo } });
  });
  const request: typeof fetch = async (_input, init) => {
    const context = JSON.parse(JSON.parse(String(init?.body)).input);
    assert.equal(context.files.length, 0);
    assert.equal(context.omittedCount, 1);
    assert.doesNotMatch(JSON.stringify(context), /fixture-confidential|config\/private/);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  };
  await runImpact(api, privateTarget, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.equal(posts, 0);
});

test('dedicated Impact emits one exact-head finding and omits private or unsupported anchors', async () => {
  const privateRepo = { id: 1468182609, full_name: 'Oddmash/oddmash-agents', private: true, visibility: 'private', owner: { login: 'Oddmash' } };
  const dedicated = { ...target, repository: privateRepo.full_name, repositoryId: privateRepo.id, private: true, advisoryIdentity: 'impact' as const };
  const bot = 'oddmash-impact[bot]';
  const writes: string[] = [];
  const issueComments: { id: number; body: string; user: { login: string } }[] = [];
  const api = githubApi('fixture', async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
    if (path.endsWith('/files')) return Response.json(['src/example.ts', 'config/private.ts'].map(filename => ({ filename, status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' })));
    if (path.endsWith('/comments')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        writes.push(path);
        if (path.includes('/pulls/')) {
          assert.equal(body.commit_id, head);
          assert.equal(body.path, 'src/example.ts');
          assert.equal(body.line, 1);
          assert.equal(body.side, 'RIGHT');
          assert.match(body.body, /oddmash-specialist:impact/);
        } else issueComments.push({ id: 10, body: body.body, user: { login: bot } });
      }
      return Response.json(path.includes('/pulls/') ? [] : issueComments);
    }
    assert.ok(path.endsWith('/pulls/7'));
    return Response.json({ title: 'Change', state: 'open', draft: false, changed_files: 2, head: { sha: head }, base: { sha: base, repo: privateRepo } });
  });
  const request: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(JSON.parse(body.input).files.map((file: { filename: string }) => file.filename), ['src/example.ts']);
    assert.ok(body.text.format.schema.required.includes('inlineFindings'));
    const inlineFindings = [
      { path: 'config/private.ts', line: 1, evidence: 'new', en: 'Private change.', ko: '비공개 변경입니다.' },
      { path: 'src/example.ts', line: 1, evidence: 'wrong line', en: 'Wrong evidence.', ko: '근거가 잘못되었습니다.' },
      { path: 'src/example.ts', line: 1, evidence: 'new', en: 'The fallback no longer appears.', ko: '대체 경로가 표시되지 않습니다.' }
    ];
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...result, inlineFindings }) }] }] });
  };
  await runImpact(api, dedicated, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  await runImpact(api, dedicated, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.deepEqual(writes, [`/repos/${privateRepo.full_name}/pulls/7/comments`, `/repos/${privateRepo.full_name}/issues/7/comments`]);
});
