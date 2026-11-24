import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoryRoles, advisoryCommand } from '../src/advisory-agents.ts';
import { route, githubApi } from '../src/webhook.ts';
import { runAdvisory, validAdvisory } from '../src/advisory.ts';
import { advisoryConfig, advisoryModelConfig } from '../src/runtime-config.ts';
import { createReviewJob, verifyReviewJob } from '../src/review-job.ts';

const user = { id: 135234546, login: 'qtaghdi', type: 'User' };
const repo = { id: 71, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
const event = (role: string, issue = false, slug = 'oddmash-reviewer') => ({ action: 'created', installation: { id: 1 }, repository: repo, sender: user, issue: { number: 7, ...(issue ? {} : { pull_request: {} }) }, comment: { id: 9, user, body: `@${slug}[bot] /${role}` } });
const result = { en: ['One', 'Two', 'Three', 'Four'], ko: ['하나', '둘', '셋', '넷'] };

test('all advisory roles are explicit, authenticated maintainer commands with correct scope', () => {
  for (const role of advisoryRoles) {
    const payload = event(role, role === 'triage');
    assert.equal(advisoryCommand(payload.comment.body, 'oddmash-reviewer'), role);
    const routed = route('issue_comment', payload, 'oddmash-reviewer');
    assert.equal(routed?.advisory, role);
    assert.equal(routed?.impact === true, role === 'impact');
    assert.equal(route('issue_comment', event(role, role !== 'triage'), 'oddmash-reviewer'), null);
    assert.equal(route('issue_comment', { ...payload, sender: { ...user, id: 1 } }, 'oddmash-reviewer'), null);
    assert.equal(route('issue_comment', event(role, role === 'triage', `oddmash-${role}`), `oddmash-${role}`)?.advisory, role);
  }
  assert.equal(advisoryCommand('@oddmash-reviewer[bot] /qa extra', 'oddmash-reviewer'), undefined);
  assert.equal(validAdvisory(result), true);
  assert.equal(validAdvisory({ ...result, en: ['<script>', 'Two', 'Three', 'Four'] }), false);
});

test('dedicated identity is signed independently and may not reuse the reviewer ID', () => {
  const target = { ...route('issue_comment', event('qa'), 'oddmash-reviewer')!, advisoryIdentity: 'qa' as const };
  const job = createReviewJob('12345678-1234-1234-1234-123456789abc', target, 'qa-fixture');
  assert.equal(verifyReviewJob(job, 'qa-fixture'), true);
  assert.equal(verifyReviewJob(job, 'reviewer-fixture'), false);
  assert.equal(verifyReviewJob({ ...job, target: { ...target, advisory: 'release' } }, 'qa-fixture'), false);
  const keys = ['QA_APP_ID', 'QA_APP_PRIVATE_KEY', 'QA_WEBHOOK_SECRET', 'QA_APP_ENABLED', 'OPENAI_API_KEY', 'REVIEWER_APP_ID'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    Object.assign(process.env, { QA_APP_ID: '123', QA_APP_PRIVATE_KEY: 'fixture', QA_WEBHOOK_SECRET: 'fixture', QA_APP_ENABLED: 'true', OPENAI_API_KEY: 'fixture', REVIEWER_APP_ID: '123' });
    assert.equal(advisoryConfig('qa'), null);
    process.env.REVIEWER_APP_ID = '456';
    assert.equal(advisoryConfig('qa')?.autoMerge, false);
    assert.equal(advisoryConfig('qa')?.slug, 'oddmash-qa');
  } finally { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
});

test('triage reads bounded related issues, posts only one advisory and never changes issue state', async () => {
  const target = route('issue_comment', event('triage', true), 'oddmash-reviewer')!;
  const comments: { id: number; body: string; user: { login: string } }[] = [];
  const writes: string[] = [];
  const bot = 'oddmash-reviewer[bot]';
  const api = githubApi('fixture', async (input, init) => {
    const url = String(input);
    if (url.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
    if (url.includes('/comments')) { if (init?.method === 'POST') { writes.push(url); comments.push({ id: 12, body: JSON.parse(String(init.body)).body, user: { login: bot } }); } return Response.json(comments); }
    if (url.includes('/issues?')) return Response.json([{ number: 8, title: 'Related report' }, { number: 9, title: 'PR not an issue', pull_request: {} }]);
    return Response.json({ number: 7, title: 'Bug report', body: 'Expected behavior', state: 'open' });
  });
  let calls = 0;
  const request: typeof fetch = async (_input, init) => { calls++; const body = JSON.parse(String(init?.body)); assert.equal(body.store, false); assert.deepEqual(JSON.parse(body.input).relatedIssues, [{ number: 8, title: 'Related report' }]); return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }); };
  await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.equal(calls, 1); assert.equal(writes.length, 1); assert.match(comments[0].body, /Oddmash Triage/);
});

test('QA receives observed check metadata without publishing a formal review', async () => {
  const target = route('issue_comment', event('qa'), 'oddmash-reviewer')!;
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const writes: string[] = [];
  const api = githubApi('fixture', async (input, init) => {
    const url = String(input);
    if (url.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
    if (url.includes('/check-runs?')) return Response.json({ total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'failure' }] });
    if (url.includes('/files?')) return Response.json([{ filename: 'src/example.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]);
    if (url.includes('/comments')) { if (init?.method === 'POST') writes.push(url); return Response.json([]); }
    return Response.json({ number: 7, title: 'Change', body: 'Expected behavior', state: 'open', draft: false, changed_files: 1, head: { sha: head }, base: { sha: base, repo } });
  });
  const request: typeof fetch = async (_input, init) => {
    const context = JSON.parse(JSON.parse(String(init?.body)).input);
    assert.deepEqual(context.observedChecks, [{ name: 'verify', status: 'completed', conclusion: 'failure' }]);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  };
  await runAdvisory(api, target, { bot: 'oddmash-reviewer[bot]', model: 'fixture', openaiKey: 'fixture' }, request);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].endsWith('/issues/7/comments'));
});


test('role model settings can be isolated without changing other roles', () => {
  const names = ['QA_OPENAI_API_KEY', 'QA_OPENAI_MODEL', 'DOCS_OPENAI_API_KEY', 'DOCS_OPENAI_MODEL'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.QA_OPENAI_API_KEY = 'qa-fixture';
    process.env.QA_OPENAI_MODEL = 'qa-model';
    delete process.env.DOCS_OPENAI_API_KEY;
    delete process.env.DOCS_OPENAI_MODEL;
    const fallback = { openaiKey: 'shared-fixture', model: 'shared-model' };
    assert.deepEqual(advisoryModelConfig('qa', fallback), { openaiKey: 'qa-fixture', model: 'qa-model' });
    assert.deepEqual(advisoryModelConfig('docs', fallback), fallback);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});
