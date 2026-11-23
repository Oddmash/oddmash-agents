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
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('api.openai.com')) {
      if (options.exhausted) return new Response('', { status: 429 });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.ok(body.text.format.schema.properties.findings.items.required.includes('korean'));
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: options.findings ? [finding] : [] }) }] }] });
    }
    if (url.includes('/files?')) return Response.json([{ filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]);
    if (url.includes('/check-runs?')) {
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return Response.json({ check_runs: [] });
    }
    if (url.includes('/contents/')) {
      if (url.includes('/repos/Oddmash/.github/')) assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return new Response('', { status: 404 });
    }
    if (url.includes('/comments?')) return Response.json(postedBody ? [{ body: postedBody }] : []);
    if (url.endsWith('/comments') && init?.method === 'POST') { assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture'); postedBody = JSON.parse(String(init.body)).body; return Response.json({ id: 1 }); }
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
  assert.equal(payload.path, 'src/ui.ts');
  assert.equal(payload.line, 1);
  assert.equal(payload.side, 'RIGHT');
  assert.equal(payload.commit_id, pr.head.sha);
  assert.match(payload.body, /```suggestion\nconst label = "Open";\n```/);
  assert.match(payload.body, /<summary>한국어 \(Korean\)<\/summary>/);
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
