import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoryRoles, advisoryCommand } from '../src/advisory-agents.ts';
import { agentSkill } from '../src/agent-guidance.ts';
import { dedicatedAdvisoryTarget, route, githubApi } from '../src/webhook.ts';
import { runAdvisory, validAdvisory } from '../src/advisory.ts';
import { publishSpecialistFindings } from '../src/specialist-findings.ts';
import { advisoryConfig, advisoryModelConfig } from '../src/runtime-config.ts';
import { createReviewJob, verifyReviewJob } from '../src/review-job.ts';
import { githubContentFixture } from './github-content-fixture.ts';

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

test('triage uses the verified default branch and refreshes one advisory when it changes', async () => {
  const target = route('issue_comment', event('triage', true), 'oddmash-reviewer')!;
  const comments: { id: number; body: string; user: { login: string } }[] = [];
  const writes: string[] = [];
  const bot = 'oddmash-reviewer[bot]';
  const defaultBranch = 'release/next';
  let base = 'b'.repeat(40);
  let branchChangesDuringRequest = false;
  const api = githubApi('fixture', async (input, init) => {
    const url = new URL(String(input));
    const root = `/repos/${repo.full_name}`;
    if (url.pathname === root) return Response.json({ ...repo, default_branch: defaultBranch });
    if (url.pathname === `${root}/branches/${encodeURIComponent(defaultBranch)}`) return Response.json({ name: defaultBranch, commit: { sha: base } });
    if (url.pathname.startsWith(`${root}/contents/`)) {
      assert.equal(url.pathname, `${root}/contents/AGENTS.md`);
      assert.equal(url.searchParams.get('ref'), base);
      return Response.json(githubContentFixture('AGENTS.md', `Project issue guidance ${base[0]}`));
    }
    if (url.pathname.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
    if (url.pathname.endsWith('/comments') || url.pathname.endsWith('/comments/12')) {
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        writes.push(`${init.method} ${url.pathname}`);
        comments[0] = { id: 12, body: JSON.parse(String(init.body)).body, user: { login: bot } };
      }
      return Response.json(comments);
    }
    if (url.pathname === `${root}/issues`) return Response.json([{ number: 8, title: 'Related report' }, { number: 9, title: 'PR not an issue', pull_request: {} }]);
    assert.equal(url.pathname, `${root}/issues/7`);
    return Response.json({ number: 7, title: 'Bug report', body: 'Expected behavior', state: 'open' });
  });
  let calls = 0;
  const request: typeof fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const context = JSON.parse(body.input);
    assert.equal(body.store, false);
    assert.deepEqual(context.relatedIssues, [{ number: 8, title: 'Related report' }]);
    assert.deepEqual(context.sharedSkill, agentSkill('triage'));
    assert.deepEqual(Object.values(context.projectGuidance), [`Project issue guidance ${base[0]}`]);
    if (branchChangesDuringRequest) base = 'd'.repeat(40);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  };
  await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.equal(calls, 1);
  base = 'c'.repeat(40);
  branchChangesDuringRequest = true;
  await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.equal(calls, 2);
  assert.equal(writes.length, 1);
  branchChangesDuringRequest = false;
  await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.equal(calls, 3);
  assert.deepEqual(writes, [`POST /repos/${repo.full_name}/issues/7/comments`, `PATCH /repos/${repo.full_name}/issues/comments/12`]);
  assert.match(comments[0].body, /Oddmash Triage/);
});

test('triage stops before guidance or a model request when repository identity changes', async () => {
  const target = route('issue_comment', event('triage', true), 'oddmash-reviewer')!;
  const paths: string[] = [];
  const api = githubApi('fixture', async input => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === `/repos/${repo.full_name}/issues/7`) return Response.json({ number: 7, state: 'open' });
    assert.equal(path, `/repos/${repo.full_name}`);
    return Response.json({ ...repo, id: repo.id + 1, default_branch: 'main' });
  });
  const request: typeof fetch = async () => assert.fail('model must not run');
  await runAdvisory(api, target, { bot: 'oddmash-reviewer[bot]', model: 'fixture', openaiKey: 'fixture' }, request);
  assert.deepEqual(paths, [`/repos/${repo.full_name}/issues/7`, `/repos/${repo.full_name}`]);
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

test('each dedicated PR advisor publishes once with its own identity and bounded request', async () => {
  for (const role of ['qa', 'release', 'docs', 'architect'] as const) {
    const slug = `oddmash-${role}`;
    const bot = `${slug}[bot]`;
    const target = dedicatedAdvisoryTarget('issue_comment', event(role, false, slug), role, slug, '')!;
    const head = 'a'.repeat(40), base = 'b'.repeat(40);
    const comments: { id: number; body: string; user: { login: string } }[] = [];
    let calls = 0;
    const inline: { body: string; user: { login: string; type: string } }[] = [];
    let summaryFailed = false;
    const api = githubApi('fixture', async (input, init) => {
      const url = String(input);
      if (url.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
      if (url.includes('/check-runs?')) return Response.json({ total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] });
      if (url.includes('/files?')) return Response.json([{ filename: 'src/example.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]);
      if (url.includes('/contents/')) {
        const guidanceUrl = new URL(url);
        assert.equal(guidanceUrl.searchParams.get('ref'), base);
        assert.match(guidanceUrl.pathname, /\/contents\/(?:src\/)?AGENTS\.md$/);
        const guidance = guidanceUrl.pathname.endsWith('/src/AGENTS.md')
          ? githubContentFixture('src/AGENTS.md', 'Scoped source guidance')
          : githubContentFixture('AGENTS.md', 'Root project guidance');
        return Response.json(guidance);
      }
      if (url.includes('/pulls/7/comments')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          assert.deepEqual({ commit: body.commit_id, path: body.path, side: body.side, line: body.line }, { commit: head, path: 'src/example.ts', side: 'RIGHT', line: 1 });
          assert.match(body.body, new RegExp(`oddmash-specialist:${role}`));
          inline.push({ body: body.body, user: { login: bot, type: 'Bot' } });
        }
        return Response.json(inline);
      }
      if (url.endsWith('/issues/7/comments') || url.includes('/issues/7/comments?')) {
        if (init?.method === 'POST' && !summaryFailed) { summaryFailed = true; return Response.json({}, { status: 503 }); }
        if (init?.method === 'POST') comments.push({ id: 12, body: JSON.parse(String(init.body)).body, user: { login: bot } });
        return Response.json(comments);
      }
      assert.ok(!init?.method || init.method === 'GET');
      return Response.json({ number: 7, title: 'Change', state: 'open', draft: false, changed_files: 1, head: { sha: head }, base: { sha: base, repo } });
    });
    const request: typeof fetch = async (_input, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const context = JSON.parse(body.input);
      assert.equal(body.max_output_tokens, 1100);
      assert.ok(body.text.format.schema.required.includes('inlineFindings'));
      assert.deepEqual(context.sharedSkill, agentSkill(role));
      assert.deepEqual(Object.values(context.projectGuidance), ['Root project guidance', 'Scoped source guidance']);
      const inlineFindings = [
        { path: 'src/example.ts', line: 1, evidence: 'new', en: 'The new case lacks a fallback.', ko: '새 사례에 대체 처리가 없습니다.' },
        { path: 'src/example.ts', line: 2, evidence: 'wrong', en: 'Invalid position.', ko: '위치가 잘못되었습니다.' }
      ];
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...result, inlineFindings }) }] }] });
    };
    await assert.rejects(runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request), /503/);
    await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
    await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
    assert.equal(calls, 2);
    assert.equal(inline.length, 1);
    assert.equal(comments.length, 1);
    assert.match(comments[0].body, new RegExp(`oddmash-advisory:${role}`));
    const summaries: string[] = [];
    const automaticTarget = { ...target, requestComment: undefined };
    await runAdvisory(api, automaticTarget, { bot, model: 'fixture', openaiKey: 'fixture', automatic: true, collectSummary: text => { summaries.push(text); } }, request);
    assert.equal(inline.length, 1);
    assert.equal(comments.length, 1);
    assert.equal(summaries.length, 1);
    assert.match(summaries[0], /Four \/ 넷/);
  }
});

test('a new slash command refreshes the same-head advisory when it removes prior context', async () => {
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const payload = event('docs');
  const slug = 'oddmash-docs';
  const bot = `${slug}[bot]`;
  const source = [
    { ...payload.comment, body: '/docs\nCheck the migration example.' },
    { ...payload.comment, id: 10, body: '/docs' }
  ];
  const targets = source.map(comment => route('issue_comment', { ...payload, comment }, 'oddmash-lead')!);
  const contexts: (string | undefined)[] = [];
  let stored: { id: number; body: string; user: { login: string } } | undefined;
  let posts = 0, edits = 0;
  const api = githubApi('fixture', async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.includes('/reactions')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 1 });
    if (path.endsWith('/comments/9') || path.endsWith('/comments/10')) return Response.json({ ...source.find(c => path.endsWith('/' + c.id)), issue_url: `https://api.github.com/repos/${repo.full_name}/issues/7` });
    if (path.endsWith('/files')) return Response.json([]);
    if (path.endsWith('/issues/7/comments') || path.endsWith('/issues/comments/11')) {
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        if (init.method === 'POST') posts++; else edits++;
        stored = { id: 11, body: JSON.parse(String(init.body)).body, user: { login: bot } };
      }
      return Response.json(stored ? [stored] : []);
    }
    return Response.json({ number: 7, state: 'open', changed_files: 0, head: { sha: head }, base: { sha: base, repo } });
  });
  const request: typeof fetch = async (_input, init) => {
    contexts.push(JSON.parse(JSON.parse(String(init?.body)).input).requestContext);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  };
  for (const target of [...targets, targets[1]]) await runAdvisory(api, target, { bot, model: 'fixture', openaiKey: 'fixture' }, request);
  assert.deepEqual(contexts, ['Check the migration example.', undefined]);
  assert.equal(posts, 1);
  assert.equal(edits, 1);
});

test('dedicated inline requests route only maintainer replies to the mentioned PR specialist', () => {
  const payload = {
    ...event('qa'), pull_request: { number: 7, draft: false },
    comment: { id: 9, user, body: '@oddmash-qa[bot] Does this cover the fallback?', in_reply_to_id: 8 }
  };
  const routeReply = (input = payload) => dedicatedAdvisoryTarget('pull_request_review_comment', input, 'qa', 'oddmash-qa', '');
  assert.deepEqual(routeReply()?.reply, { comment: 9, root: 8 });
  assert.equal(routeReply()?.advisoryIdentity, 'qa');
  assert.equal(routeReply()?.recheck, undefined);
  assert.equal(routeReply({ ...payload, sender: { ...user, id: 99 } }), null);
  assert.equal(routeReply({ ...payload, comment: { ...payload.comment, in_reply_to_id: 0 } }), null);
  assert.equal(routeReply({ ...payload, comment: { ...payload.comment, body: '@oddmash-qa[bot] /review' } }), null);
  assert.equal(dedicatedAdvisoryTarget('pull_request_review_comment', payload, 'docs', 'oddmash-docs', ''), null);
  assert.equal(dedicatedAdvisoryTarget('pull_request_review_comment', { ...payload, comment: { ...payload.comment, body: '@oddmash-triage Question?' } }, 'triage', 'oddmash-triage', ''), null);
});

test('coordinated specialists keep one thread for a matching finding and preserve distinct concerns', async () => {
  const sha = 'c'.repeat(40);
  const path = 'src/style.css';
  const previous = {
    body: '<!-- oddmash-finding:aaaaaaaaaaaaaaaaaaaaaaaa -->\nNegative focus outline offset can draw the visible focus indicator inside the link and reduce keyboard focus clarity.',
    path, line: 1, commit_id: sha, side: 'RIGHT', user: { login: 'oddmash-release[bot]', type: 'Bot' }
  };
  const posts: string[] = [];
  const api = githubApi('fixture', async (_input, init) => {
    if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)).body);
    return Response.json(init?.method === 'POST' ? {} : [previous]);
  });
  const target = { installation: 1, repository: repo.full_name, repositoryId: repo.id, number: 7, advisory: 'qa' as const, advisoryIdentity: 'qa' as const };
  const files = [{ filename: path, patch: '@@ -1 +1 @@\n-old\n+new', status: 'modified' }];
  const matching = 'Negative focus outline offset can draw the indicator inside or clipped against the link boundary.';
  const distinct = 'The color property no longer meets contrast requirements on a dark background.';
  for (const en of [matching, distinct]) await publishSpecialistFindings(api, target, 'oddmash-qa[bot]', sha, {
    inlineFindings: [{ path, line: 1, evidence: 'new', en, ko: '표시 상태를 확인하세요.' }]
  }, files, async () => true);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /contrast requirements/);
});
