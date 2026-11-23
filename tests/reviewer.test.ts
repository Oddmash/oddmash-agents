import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview } from '../src/reviewer.ts';

const config = { repository: 'Oddmash/example', number: 1, githubToken: 'fixture', openaiKey: 'fixture', model: 'fixture', post: false, allowedRepositories: ['Oddmash/example'] };
const pr = { title: 'UI change', state: 'open', draft: false, base: { sha: 'a'.repeat(40), repo: { private: false, full_name: config.repository } }, head: { sha: 'b'.repeat(40) }, changed_files: 1 };
const mock = (options: { private?: boolean; exhausted?: boolean } = {}) => {
  const calls: { url: string; method: string }[] = [];
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.includes('api.openai.com')) {
      if (options.exhausted) return new Response('', { status: 429 });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ findings: [] }) }] }] });
    }
    if (url.includes('/files?')) return Response.json([{ filename: 'src/ui.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }]);
    if (url.includes('/check-runs?')) return Response.json({ check_runs: [] });
    if (url.includes('/contents/')) return new Response('', { status: 404 });
    if (url.endsWith('/pulls/1')) return Response.json({ ...pr, base: { ...pr.base, repo: { ...pr.base.repo, private: options.private ?? false } } });
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
