import test from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePull, linkedIssue, acceptanceOf, lowRisk, acceptanceSatisfied, protectedBranch, mergeAuthorized, type MergePull, type Candidate } from '../src/auto-merge.ts';
import { githubApi } from '../src/webhook.ts';

const target = { installation: 1, repository: 'Oddmash/kowrap', repositoryId: 42 };
const user = { id: 135234546, login: 'qtaghdi' };
const head = 'a'.repeat(40), base = 'b'.repeat(40), merge = 'c'.repeat(40);
const pr: MergePull = { number: 10, state: 'open', draft: false, user, body: 'Closes #9', changed_files: 1, mergeable: true, mergeable_state: 'clean', merge_commit_sha: merge, head: { sha: head, repo: { id: 42, full_name: target.repository } }, base: { sha: base, ref: 'main', repo: { id: 42, full_name: target.repository, default_branch: 'main', private: false } }, labels: [] };
const issue = { number: 9, state: 'open', user, body: '## Acceptance criteria\n\n- [ ] Explain the example clearly.\n- [ ] Document the expected output.\n\n## Notes\nNo other scope.', updated_at: '2026-01-01T00:00:00Z' };
const files = [{ filename: 'docs/example.md', status: 'modified', patch: '@@ -1 +1,2 @@\n-old\n+example\n+output' }];
const branch = { protected: true, commit: { sha: base }, protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone', checks: [{ context: 'verify', app_id: 15368 }] } } };
const candidate: Candidate = { pull: pr, acceptance: acceptanceOf(issue)! };

test('only maintainer-owned same-repository public main PRs are candidates', () => {
  assert.equal(eligiblePull(pr, target), true);
  assert.equal(eligiblePull({ ...pr, user: { id: 99, login: user.login } }, target), false);
  assert.equal(eligiblePull({ ...pr, head: { ...pr.head, repo: { id: 99, full_name: 'other/fork' } } }, target), false);
  assert.equal(eligiblePull({ ...pr, base: { ...pr.base, repo: { ...pr.base.repo, private: true } } }, target), false);
  assert.equal(eligiblePull({ ...pr, labels: [{ name: 'do not merge' }] }, target), false);
  assert.equal(eligiblePull(pr, { ...target, repository: 'Oddmash/.github' }), false);
});

test('requires one linked issue and all explicit criteria', () => {
  assert.equal(linkedIssue('Closes #9'), 9);
  assert.equal(linkedIssue('Closes #9\nFixes #10'), null);
  assert.equal(linkedIssue('Closes #9\nAlso fixes Other/repo#10'), null);
  assert.equal(acceptanceOf(issue)?.criteria.length, 2);
  assert.equal(acceptanceOf({ ...issue, user: { id: 1, login: 'other' } }), null);
  assert.equal(acceptanceOf({ ...issue, body: '## Acceptance criteria\nNo tests.' }), null);
  const proof = [{ criterion: 0, fulfilled: true, path: 'docs/example.md', line: 1, evidence: 'Example is described.' }, { criterion: 1, fulfilled: true, path: 'docs/example.md', line: 2, evidence: 'Output is documented.' }];
  assert.equal(acceptanceSatisfied(proof, candidate.acceptance, files), true);
  assert.equal(acceptanceSatisfied(proof.slice(0, 1), candidate.acceptance, files), false);
  assert.equal(acceptanceSatisfied([proof[0], { ...proof[1], line: 99 }], candidate.acceptance, files), false);
  assert.equal(acceptanceSatisfied([proof[0], { ...proof[1], fulfilled: false }], candidate.acceptance, files), false);
});

test('rejects sensitive paths, source and weakening existing tests', () => {
  assert.equal(lowRisk(files, 1), true);
  assert.equal(lowRisk([{ ...files[0], filename: 'src/main.ts' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'docs/AGENTS.md' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: '.github/workflows/ci.yml' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'tests/a.test.ts' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'tests/a.test.ts', status: 'added' }], 1), false);
  assert.equal(lowRisk(files, 2), false);
  assert.equal(protectedBranch(branch, base), true);
  assert.equal(protectedBranch({ ...branch, protected: false }, base), false);
});

test('mint write token only after exact-head approval and protected current CI', async () => {
  let writes = 0;
  let mints = 0;
  const makeApi = (passing = true) => githubApi('fixture-token', async (input, init) => {
    const url = String(input);
    if (url.endsWith('/pulls/10')) return Response.json(pr);
    if (url.endsWith('/issues/9')) return Response.json(issue);
    if (url.includes('/files?')) return Response.json(files);
    if (url.endsWith('/branches/main')) return Response.json(branch);
    if (url.includes('/compare/')) return Response.json({ behind_by: 0, merge_base_commit: { sha: base } });
    if (url.includes('/reviews?')) return Response.json([{ id: 5, user: { login: 'oddmash-reviewer[bot]', id: 100 }, state: 'APPROVED', commit_id: head }]);
    if (url.includes('/check-runs?')) return Response.json({ total_count: 1, check_runs: [{ id: 1, name: 'verify', app: { id: 15368 }, status: 'completed', conclusion: passing ? 'success' : 'failure' }] });
    if (url.endsWith('/status')) return Response.json({ total_count: 0, state: 'pending', statuses: [] });
    if (url.endsWith('/merge')) { writes++; assert.equal(JSON.parse(String(init?.body)).sha, head); return Response.json({ merged: true }); }
    if (url.endsWith('/installation/token')) return new Response(null, { status: 204 });
    throw new Error('Unexpected fixture request');
  });
  const mint = async () => { mints++; return makeApi(); };
  assert.equal(await mergeAuthorized(makeApi(false), target, candidate, 'oddmash-reviewer[bot]', 5, true, mint), false);
  assert.equal(await mergeAuthorized(makeApi(), target, candidate, 'oddmash-reviewer[bot]', 5, false, mint), false);
  assert.equal(mints, 0);
  assert.equal(await mergeAuthorized(makeApi(), target, candidate, 'oddmash-reviewer[bot]', 5, true, mint), true);
  assert.equal(mints, 1);
  assert.equal(writes, 1);
});
