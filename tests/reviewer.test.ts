import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview } from '../src/reviewer.ts';

const config = { repository: 'Oddmash/example', number: 1, githubToken: 'fixture', openaiKey: 'fixture', model: 'fixture', post: false, allowedRepositories: ['Oddmash/example'] };
const pr = { title: 'UI change', state: 'open', draft: false, base: { sha: 'a'.repeat(40), repo: { private: false, full_name: config.repository } }, head: { sha: 'b'.repeat(40) }, changed_files: 1 };
const finding = { path: 'src/ui.ts', line: 1, severity: 'medium', confidence: 'high', rule: 'Accessibility', evidence: 'The label is empty.', recommendation: 'Use a visible label.', verification: 'Inspect accessible name.', suggestion: 'const label = "Open";', korean: { rule: '접근성', evidence: '레이블이 비어 있습니다.', recommendation: '레이블을 추가하세요.', verification: '접근 가능한 이름을 확인하세요.' } };
const mock = (options: { private?: boolean; exhausted?: boolean; findings?: boolean; duplicate?: boolean; stale?: boolean } = {}) => {
  const calls: { url: string; method: string; body?: string }[] = [];
  let prReads = 0;
  let postedBody = '';
  let postedReview = '';
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('api.openai.com')) {
      if (options.exhausted) return new Response('', { status: 429 });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.ok(body.text.format.schema.properties.findings.items.required.includes('korean'));
      assert.deepEqual(JSON.parse(body.input).allowedFindingLines, { 'src/ui.ts': [1] });
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: options.findings ? [finding] : [] }) }] }] });
    }
    if (url.includes('/files?')) return Response.json([{ filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]);
    if (url.includes('/check-runs?')) {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture');
      return Response.json({ check_runs: [] });
    }
    if (url.includes('/contents/')) {
      if (url.includes('/repos/Oddmash/.github/')) assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return new Response('', { status: 404 });
    }
    if (url.includes('/comments?')) return Response.json(postedBody ? [{ body: postedBody }] : []);
    if (url.includes('/reviews?')) return Response.json(postedReview ? [{ id: 1, body: postedReview, state: 'COMMENTED', commit_id: pr.head.sha, user: { id: 2 } }] : []);
    if (url.endsWith('/reviews') && init?.method === 'POST') { assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture'); const payload = JSON.parse(String(init.body)); postedBody = payload.comments[0].body; postedReview = payload.body; return Response.json({ id: 1 }); }
    if (url.endsWith('/user')) return Response.json({ id: 2 });
    if (url.endsWith('/reviews/1') && init?.method === 'PUT') { postedReview = JSON.parse(String(init.body)).body; return Response.json({ id: 1 }); }
    if (url.endsWith('/pulls/1')) { prReads++; return Response.json({ ...pr, head: options.stale && prReads > 1 ? { sha: 'c'.repeat(40) } : pr.head, base: { ...pr.base, repo: { ...pr.base.repo, private: options.private ?? false } } }); }
    throw new Error('Unexpected request');
  };
  return { calls, request: request as typeof fetch };
};

test('report-only never writes to GitHub', async () => {
  const { request, calls } = mock();
  const result = await runReview(config, request);
  assert.equal(result.posted, false);
  assert.match(result.report, /No validated findings/);
  assert.ok(calls.filter(x => x.url.includes('api.github.com')).every(x => x.method === 'GET'));
});

test('issue acceptance sends explicit zero-based criterion IDs and validates exact evidence', async () => {
  const { request } = mock();
  const acceptance = { issue: 9, digest: 'fixture', body: '## Acceptance criteria\n- [ ] Document the output clearly.', criteria: ['Document the output clearly.'] };
  const reviewed = await runReview({ ...config, acceptance }, async (input, init) => {
    if (!String(input).includes('api.openai.com')) return request(input, init);
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(JSON.parse(payload.input).issueAcceptance.criteria, [{ criterion: 0, requirement: acceptance.criteria[0] }]);
    assert.deepEqual(payload.text.format.schema.properties.acceptance.items.properties.criterion.enum, [0]);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: [], allRequirementsMet: true, acceptance: [{ criterion: 0, fulfilled: true, path: 'src/ui.ts', line: 1, evidence: 'The added line documents the output.' }] }) }] }] });
  });
  assert.equal(reviewed.issueVerified, true);
});

test('private repo never reaches model', async () => {
  const { request, calls } = mock({ private: true });
  await assert.rejects(runReview(config, request), /public/);
  assert.equal(calls.length, 1);
});

test('credit exhaustion stops without retry', async () => {
  const { request, calls } = mock({ exhausted: true });
  await assert.rejects(runReview(config, request), /credit limit/);
  assert.equal(calls.filter(x => x.url.includes('api.openai.com')).length, 1);
});

test('posts a suggested change on the exact right-side line and skips repeat findings', async () => {
  const { request, calls } = mock({ findings: true });
  const first = await runReview({ ...config, post: true }, request);
  assert.equal(first.posted, true);
  const post = calls.find(x => x.method === 'POST' && x.url.includes('api.github.com'));
  assert.ok(post?.body);
  const payload = JSON.parse(post.body);
  assert.equal(payload.event, 'COMMENT');
  assert.equal(payload.comments.length, 1);
  assert.equal(payload.comments[0].path, 'src/ui.ts');
  assert.equal(payload.comments[0].line, 1);
  assert.equal(payload.comments[0].side, 'RIGHT');
  assert.equal(payload.commit_id, pr.head.sha);
  assert.match(payload.comments[0].body, /```suggestion\nconst label = "Open";\n```/);
  assert.match(payload.comments[0].body, /<summary>한국어 \(Korean\)<\/summary>/);
  const second = await runReview({ ...config, post: true }, request);
  assert.equal(second.posted, false);
  assert.equal(calls.filter(x => x.method === 'POST' && x.url.includes('api.github.com')).length, 1);
});

test('never posts after head changes', async () => {
  const { request, calls } = mock({ findings: true, stale: true });
  const result = await runReview({ ...config, post: true }, request);
  assert.equal(result.posted, false);
  assert.ok(calls.filter(x => x.url.includes('api.github.com')).every(x => x.method === 'GET'));
});

test('refreshes an existing CLI advisory without creating another review when findings disappear', async () => {
  const { request, calls } = mock({ findings: true });
  await runReview({ ...config, post: true }, request);
  const result = await runReview({ ...config, post: true }, async (input, init) => String(input).includes('api.openai.com') ? Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: [] }) }] }] }) : request(input, init));
  assert.equal(result.posted, true);
  assert.equal(calls.filter(call => call.method === 'POST' && call.url.includes('api.github.com')).length, 1);
  assert.equal(calls.filter(call => call.method === 'PUT' && call.url.endsWith('/reviews/1')).length, 1);
});

test('approved private review uses scoped auth and excludes private sensitive data from model input', async () => {
  const repo = 'Oddmash/oddmash-skills';
  const privateId = 1468154482;
  const privateConfig = { ...config, repository: repo, allowedRepositories: [repo], privateRepositoryId: privateId };
  let modelCalls = 0;
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('api.openai.com')) {
      modelCalls++;
      const payload = JSON.parse(String(init?.body));
      const model = JSON.parse(payload.input);
      assert.equal(payload.store, false);
      assert.deepEqual(model.files.map((file: { filename: string }) => file.filename), ['src/ui.ts']);
      assert.equal(model.omitted.length, 3);
      assert.ok(model.omitted.every((file: string) => file === 'Omitted private file'));
      assert.doesNotMatch(payload.input, /fixture-hidden-name|synthetic-fixture-value|fixture-sensitive-guidance/);
      assert.equal(model.issueAcceptance, null);
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: [], acceptance: [], allRequirementsMet: false }) }] }] });
    }
    if (url.includes('/repos/Oddmash/.github/contents/')) { assert.equal(new Headers(init?.headers).has('Authorization'), false); return new Response(null, { status: 404 }); }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture');
    if (url.includes('/files?')) return Response.json([
      { filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: '.github/workflows/fixture-hidden-name.yml', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: 'src/renamed.ts', previous_filename: 'config/fixture-hidden-name.ts', status: 'renamed', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: 'src/other.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+password: synthetic-fixture-value' }
    ]);
    if (url.includes('/check-runs?')) return Response.json({ total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] });
    if (url.includes('/contents/')) return Response.json({ encoding: 'base64', content: Buffer.from('password: fixture-sensitive-guidance').toString('base64') });
    if (url.endsWith('/pulls/1')) return Response.json({ ...pr, changed_files: 4, base: { ...pr.base, repo: { id: privateId, private: true, full_name: repo } } });
    throw new Error('Unexpected fixture request');
  };
  const result = await runReview(privateConfig, request);
  assert.equal(modelCalls, 1);
  assert.equal(result.decision, 'COMMENT');
  assert.equal(result.issueVerified, false);
  await assert.rejects(runReview({ ...privateConfig, privateRepositoryId: 99 }, request), /not explicitly enabled/);
  await assert.rejects(runReview({ ...privateConfig, githubToken: '' }, request), /not explicitly enabled/);
});

test('fully reviewed approved private PR can approve without any merge proof', async () => {
  const repository = 'Oddmash/oddmash-skills';
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('api.openai.com')) return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: [], acceptance: [], allRequirementsMet: false }) }] }] });
    if (url.includes('/files?')) return Response.json([{ filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]);
    if (url.includes('/check-runs?')) { assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture'); return Response.json({ total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] }); }
    if (url.includes('/contents/')) return new Response(null, { status: 404 });
    if (url.endsWith('/pulls/1')) return Response.json({ ...pr, base: { ...pr.base, repo: { id: 1468154482, private: true, full_name: repository } } });
    throw new Error('Unexpected fixture request');
  };
  const result = await runReview({ ...config, repository, allowedRepositories: [repository], privateRepositoryId: 1468154482 }, request);
  assert.equal(result.decision, 'APPROVE');
  assert.equal(result.issueVerified, false);
});
