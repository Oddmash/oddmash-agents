import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmBlockingFindings, runReview } from '../src/reviewer.ts';
import { reviewAssessment, type Finding, type ReviewContext } from '../src/core.ts';
import { githubContentFixture } from './github-content-fixture.ts';

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
      const modelInput = JSON.parse(body.input);
      assert.deepEqual(modelInput.allowedFindingLines, { 'src/ui.ts': [1] });
      assert.match(modelInput.sharedSkill.path, /oddmash-code-review-collaboration/);
      assert.match(modelInput.sharedSkill.revision, /^[0-9a-f]{40}$/);
      assert.ok(modelInput.sharedSkill.text);
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

test('Lead uses related project guidance from the PR base alongside the organization rules', async () => {
  const { request } = mock();
  const projectReads: string[] = [];
  await runReview(config, async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.openai.com') {
      const model = JSON.parse(JSON.parse(String(init?.body)).input);
      assert.deepEqual(model.guidance, {
        'Oddmash/.github/AGENTS.md': 'Organization rules.',
        'Oddmash/example/AGENTS.md': 'Project rules.',
        'Oddmash/example/src/AGENTS.md': 'Source rules.'
      });
    }
    if (url.pathname === '/repos/Oddmash/.github/contents/AGENTS.md') {
      assert.equal(url.searchParams.get('ref'), 'main');
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return Response.json({ encoding: 'base64', content: Buffer.from('Organization rules.').toString('base64') });
    }
    if (url.pathname.endsWith('/AGENTS.md')) {
      assert.equal(url.searchParams.get('ref'), pr.base.sha);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture');
      projectReads.push(url.pathname);
      const text = url.pathname.includes('/contents/src/') ? 'Source rules.' : 'Project rules.';
      return Response.json(githubContentFixture(url.pathname.split('/contents/')[1], text));
    }
    return request(input, init);
  });
  assert.deepEqual(projectReads.sort(), ['/repos/Oddmash/example/contents/AGENTS.md', '/repos/Oddmash/example/contents/src/AGENTS.md']);
});

test('Lead withholds a review when the GitHub project guidance read fails', async () => {
  const { request, calls } = mock();
  await assert.rejects(runReview(config, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/Oddmash/example/contents/AGENTS.md') return new Response(null, { status: 503 });
    return request(input, init);
  }), /GitHub request failed \(503\)/);
  assert.ok(!calls.some(call => call.url.includes('api.openai.com')));
});

test('review reports explain image omissions and unfetched files without sending diagnostic metadata to the model', async () => {
  const { request } = mock();
  const result = await runReview(config, async (input, init) => {
    const url = String(input);
    if (url.includes('/files?')) return Response.json([{ filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }, { filename: 'docs/assets/demo.png', status: 'modified' }]);
    if (url.endsWith('/pulls/1')) return Response.json({ ...pr, changed_files: 3 });
    if (url.includes('api.openai.com')) assert.equal(JSON.parse(JSON.parse(String(init?.body)).input).omissionDetails, undefined);
    return request(input, init);
  });
  assert.equal(result.assessment, 'COMMENT');
  assert.match(result.report, /`docs\/assets\/demo.png`: Image has no text diff/);
  assert.match(result.report, /\(1 unlisted\): Files beyond the fetched page/);
});

test('public head context includes same-file guards and curated feedback without new finding anchors', async () => {
  const { request } = mock();
  const source = 'const select = item => { if (item.disabled) return; item.onSelect(); };';
  let checked = false;
  await runReview(config, async (input, init) => {
    const url = String(input);
    if (url.includes('/contents/src/ui.ts?ref=' + pr.head.sha)) return Response.json({ encoding: 'base64', content: Buffer.from(source).toString('base64') });
    if (url.includes('api.openai.com')) {
      const body = JSON.parse(String(init?.body));
      const context = JSON.parse(body.input);
      assert.equal(context.changedHeadFiles['src/ui.ts'], source);
      assert.deepEqual(context.allowedFindingLines, { 'src/ui.ts': [1] });
      assert.ok(context.feedback.some((rule: string) => rule.includes('shared guard')));
      checked = true;
    }
    return request(input, init);
  });
  assert.equal(checked, true);
});

test('candidate blockers require an independent, complete affirmative verdict', async () => {
  const context: ReviewContext = { repository: config.repository, number: 1, head: pr.head.sha, title: 'UI', files: [{ filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }], guidance: {}, checks: [], omitted: [] };
  const candidate = { ...finding, blockingEvidence: { excerpt: 'new', impact: 'The accessible name is missing.', requirement: 'Buttons have accessible names.' } } as Finding;
  const reply = (verdicts: unknown): typeof fetch => async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'oddmash_blocker_confirmation');
    const modelInput = JSON.parse(body.input);
    assert.equal(modelInput.candidates.length, 1);
    assert.match(modelInput.sharedSkill.path, /oddmash-code-review-collaboration/);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ verdicts }) }] }] });
  };
  const approved = await confirmBlockingFindings(context, [candidate], config, reply([{ index: 0, confirmed: true }]));
  assert.equal(reviewAssessment(context, approved, true), 'REQUEST_CHANGES');
  for (const result of [[{ index: 0, confirmed: false }], [{ index: 1, confirmed: true }], []]) {
    const reviewed = await confirmBlockingFindings(context, [candidate], config, reply(result));
    assert.equal(reviewAssessment(context, reviewed, true), 'COMMENT');
  }
  const failed = await confirmBlockingFindings(context, [candidate], config, async () => new Response(null, { status: 429 }));
  assert.equal(reviewAssessment(context, failed, true), 'COMMENT');
  await confirmBlockingFindings(context, [finding as Finding], config, async () => { throw new Error('Advisory findings must not call the model again'); });
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
      assert.deepEqual(model.files.map((file: { filename: string }) => file.filename), ['src/ui.ts', '.github/workflows/prepare-release.yml', 'scripts/prepare-release.mjs', 'src/auth/session.ts']);
      assert.equal(model.omitted.length, 4);
      assert.ok(model.omitted.every((file: string) => file === 'Omitted private file'));
      assert.equal(model.omissionDetails, undefined);
      assert.doesNotMatch(payload.input, /fixture-hidden-name|synthetic-fixture-value|fixture-sensitive-guidance|src\/other.ts|docs\/diagram.png/);
      assert.equal(model.issueAcceptance, null);
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: [], acceptance: [], allRequirementsMet: false }) }] }] });
    }
    if (url.includes('/repos/Oddmash/.github/contents/')) { assert.equal(new Headers(init?.headers).has('Authorization'), false); return new Response(null, { status: 404 }); }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture');
    if (url.includes('/files?')) return Response.json([
      { filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: '.github/workflows/prepare-release.yml', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: 'scripts/prepare-release.mjs', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+const token = process.env.GITHUB_TOKEN;' },
      { filename: 'src/auth/session.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: '.github/secrets/fixture-hidden-name.yml', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: 'src/renamed.ts', previous_filename: 'config/fixture-hidden-name.ts', status: 'renamed', patch: '@@ -1 +1 @@\n-old\n+new' },
      { filename: 'src/other.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+password: synthetic-fixture-value' },
      { filename: 'docs/diagram.png', status: 'modified' }
    ]);
    if (url.includes('/check-runs?')) return Response.json({ total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] });
    if (url.includes('/contents/')) return Response.json(githubContentFixture(new URL(url).pathname.split('/contents/')[1], 'password: fixture-sensitive-guidance'));
    if (url.endsWith('/pulls/1')) return Response.json({ ...pr, changed_files: 8, base: { ...pr.base, repo: { id: privateId, private: true, full_name: repo } } });
    throw new Error('Unexpected fixture request');
  };
  const result = await runReview(privateConfig, request);
  assert.equal(modelCalls, 1);
  assert.equal(result.decision, 'COMMENT');
  assert.equal(result.issueVerified, false);
  assert.match(result.report, /Confidential path/);
  assert.match(result.report, /`src\/other.ts`: Potentially sensitive content excluded/);
  assert.match(result.report, /`docs\/diagram.png`: Image has no text diff/);
  assert.doesNotMatch(result.report, /fixture-hidden-name|synthetic-fixture-value|fixture-sensitive-guidance|src\/renamed.ts/);
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

test('only a stable complete empty full-scope PR is confirmed empty without model usage', async () => {
  const cases = [
    { name: 'confirmed zero', count: 0, listing: [], expected: true },
    { name: 'partial listing', count: 2, listing: [], expected: false },
    { name: 'missing count', count: undefined, listing: [], expected: false },
    { name: 'null listing', count: 0, listing: null, expected: false },
    { name: 'paginated empty listing', count: 0, listing: [], link: '<https://api.github.com/page2>; rel="next"', expected: false },
    { name: 'incremental empty scope', count: 0, listing: [], incremental: [] as string[], expected: false },
    { name: 'contradictory recheck', count: 0, listing: [], recheckCount: 1, expected: false },
    { name: 'omitted file', count: 1, listing: [{ filename: 'docs/demo.png', status: 'modified' }], expected: false },
    { name: 'contradictory omitted file', count: 0, listing: [{ filename: 'docs/demo.png', status: 'modified' }], expected: false }
  ];
  for (const scenario of cases) {
    const { request } = mock();
    let reads = 0;
    const result = await runReview({ ...config, incrementalFiles: scenario.incremental }, async (input, init) => {
      const url = String(input);
      assert.ok(!url.includes('api.openai.com'), scenario.name);
      if (url.endsWith('/pulls/1')) {
        reads++;
        return Response.json({ ...pr, changed_files: reads > 1 && scenario.recheckCount !== undefined ? scenario.recheckCount : scenario.count });
      }
      if (url.includes('/files?')) return Response.json(scenario.listing, { headers: scenario.link ? { link: scenario.link } : undefined });
      return request(input, init);
    });
    assert.equal(result.followUp.confirmedEmpty ?? false, scenario.expected, scenario.name);
    assert.equal(result.followUp.incompleteCoverage, !scenario.expected, scenario.name);
    assert.equal(result.followUp.invalidEvidence, !scenario.expected, scenario.name);
    assert.equal(result.assessment, 'COMMENT', scenario.name);
    assert.equal(result.decision, 'COMMENT', scenario.name);
    assert.equal(result.issueVerified, false, scenario.name);
    assert.deepEqual(result.comments, [], scenario.name);
  }
});

test('withholds empty review if the PR changes while verifying the empty file listing', async () => {
  const { request } = mock();
  let reads = 0;
  await assert.rejects(runReview(config, async (input, init) => {
    const url = String(input);
    assert.ok(!url.includes('api.openai.com'));
    if (url.endsWith('/pulls/1')) return Response.json({ ...pr, changed_files: 0, head: ++reads === 1 ? pr.head : { sha: 'c'.repeat(40) } });
    if (url.includes('/files?')) return Response.json([]);
    return request(input, init);
  }), /PR changed while confirming an empty review/);
});

test('contradictory zero metadata cannot approve even with valid model output for listed changes', async () => {
  const { request } = mock();
  const result = await runReview(config, async (input, init) => {
    if (String(input).endsWith('/pulls/1')) return Response.json({ ...pr, changed_files: 0 });
    return request(input, init);
  });
  assert.equal(result.assessment, 'COMMENT');
  assert.equal(result.followUp.confirmedEmpty, undefined);
  assert.equal(result.followUp.incompleteCoverage, true);
  assert.match(result.report, /GitHub file-list metadata was missing or inconsistent/);
});
