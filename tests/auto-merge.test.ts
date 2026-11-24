import test from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePull, linkedIssue, acceptanceOf, lowRisk, lowRiskReason, acceptanceSatisfied, protectedBranch, mergeAuthorized, mergeProof, type MergePull, type Candidate } from '../src/auto-merge.ts';
import { githubApi, mergeRepositoryAllowed } from '../src/webhook.ts';

const target = { installation: 1, repository: 'Oddmash/kowrap', repositoryId: 42 };
const user = { id: 135234546, login: 'qtaghdi' };
const head = 'a'.repeat(40), base = 'b'.repeat(40), merge = 'c'.repeat(40);
const pr: MergePull = { number: 10, state: 'open', draft: false, user, body: 'Closes #9', changed_files: 1, mergeable: true, mergeable_state: 'clean', merge_commit_sha: merge, head: { sha: head, repo: { id: 42, full_name: target.repository } }, base: { sha: base, ref: 'main', repo: { id: 42, full_name: target.repository, default_branch: 'main', private: false } }, labels: [] };
const issue = { number: 9, state: 'open', user, body: '## Acceptance criteria\n\n- [ ] Explain the example clearly.\n- [ ] Document the expected output.\n\n## Notes\nNo other scope.', updated_at: '2026-01-01T00:00:00Z' };
const files = [{ filename: 'docs/example.md', status: 'modified', patch: '@@ -1 +1,2 @@\n-old\n+example\n+output' }];
const branch = { protected: true, commit: { sha: base }, protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone', checks: [{ context: 'verify', app_id: 15368 }] } } };
const candidate: Candidate = { pull: pr, acceptance: acceptanceOf(issue)! };

test('merge retry proof binds approval to the exact PR, head, base, merge commit and issue', () => {
  const marker = mergeProof(candidate);
  assert.equal(marker, mergeProof({ ...candidate }));
  assert.notEqual(marker, mergeProof({ ...candidate, pull: { ...pr, base: { ...pr.base, ref: 'develop' } } }));
  assert.notEqual(marker, mergeProof({ ...candidate, pull: { ...pr, number: 11 } }));
  assert.notEqual(marker, mergeProof({ ...candidate, pull: { ...pr, head: { ...pr.head, sha: 'd'.repeat(40) } } }));
  assert.notEqual(marker, mergeProof({ ...candidate, pull: { ...pr, base: { ...pr.base, sha: 'd'.repeat(40) } } }));
  assert.notEqual(marker, mergeProof({ ...candidate, pull: { ...pr, merge_commit_sha: 'd'.repeat(40) } }));
  assert.notEqual(marker, mergeProof({ ...candidate, acceptance: { ...candidate.acceptance, digest: 'changed' } }));
});

test('only maintainer-owned same-repository eligible main PRs are candidates', () => {
  assert.equal(eligiblePull(pr, target), true);
  assert.equal(eligiblePull({ ...pr, base: { ...pr.base, ref: 'develop' } }, target), true);
  assert.equal(eligiblePull({ ...pr, base: { ...pr.base, ref: 'feature/example' } }, target), false);
  assert.equal(eligiblePull({ ...pr, user: { id: 99, login: user.login } }, target), false);
  assert.equal(eligiblePull({ ...pr, head: { ...pr.head, repo: { id: 99, full_name: 'other/fork' } } }, target), false);
  assert.equal(eligiblePull({ ...pr, base: { ...pr.base, repo: { ...pr.base.repo, private: true } } }, target), false);
  assert.equal(eligiblePull({ ...pr, labels: [{ name: 'do not merge' }] }, target), false);
  assert.equal(eligiblePull(pr, { ...target, repository: 'Oddmash/.github' }), false);
});

test('explicitly approved private identities are candidates but visibility and IDs cannot mismatch', () => {
  const privateRepos = { 'Oddmash/oddmash-agents': 1468182609, 'Oddmash/oddmash-skills': 1468154482, 'Oddmash/overtime-prototype': 1461455091, 'Oddmash/cash-out': 1462488077, 'Oddmash/oddmash-website': 1468561714 };
  for (const [repository, repositoryId] of Object.entries(privateRepos)) {
    const target = { installation: 1, repository, repositoryId, private: true };
    const identity = { id: repositoryId, full_name: repository };
    const pull = { ...pr, head: { sha: head, repo: identity }, base: { ...pr.base, repo: { ...identity, default_branch: 'main', private: true } } };
    assert.equal(mergeRepositoryAllowed(target), true);
    assert.equal(eligiblePull(pull, target), true);
    assert.equal(eligiblePull(pull, { ...target, repositoryId: 99 }), false);
    assert.equal(eligiblePull(pull, { ...target, private: false }), false);
    assert.equal(eligiblePull({ ...pull, base: { ...pull.base, repo: { ...pull.base.repo, private: false } } }, target), false);
  }
  assert.equal(mergeRepositoryAllowed({ installation: 1, repository: 'Oddmash/unknown', repositoryId: 123, private: true }), false);
  assert.equal(acceptanceOf({ ...issue, body: issue.body + '\npassword: fixture-private-value' }, true), null);
});

test('all current public product repositories are eligible while organization governance remains manual', () => {
  for (const repository of ['Oddmash/kowrap', 'Oddmash/oddmash-ui', 'Oddmash/interaction-inspector', 'Oddmash/Vertactics', 'Oddmash/boundra']) {
    assert.equal(mergeRepositoryAllowed({ installation: 1, repository, repositoryId: 42 }), true);
  }
  assert.equal(mergeRepositoryAllowed({ installation: 1, repository: 'Oddmash/.github', repositoryId: 42 }), false);
  assert.equal(mergeRepositoryAllowed({ installation: 1, repository: 'Oddmash/unknown', repositoryId: 42 }), false);
});

test('organization documentation requires exact public identity, main and maintainer authorship', () => {
  const repository = 'Oddmash/.github';
  const repositoryId = 1455305553;
  const target = { installation: 1, repository, repositoryId };
  const identity = { id: repositoryId, full_name: repository };
  const pull = { ...pr, head: { sha: head, repo: identity }, base: { ...pr.base, repo: { ...identity, default_branch: 'main', private: false } } };
  assert.equal(mergeRepositoryAllowed(target), true);
  assert.equal(mergeRepositoryAllowed({ ...target, repositoryId: 42 }), false);
  assert.equal(mergeRepositoryAllowed({ ...target, private: true }), false);
  assert.equal(eligiblePull(pull, target), true);
  assert.equal(eligiblePull({ ...pull, base: { ...pull.base, ref: 'develop' } }, target), false);
  assert.equal(eligiblePull({ ...pull, user: { id: 99, login: user.login } }, target), false);
  for (const filename of ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md', 'profile/README.md', 'docs/ko/README.md', 'docs/ja/README.md', 'docs/zh-CN/README.md', 'docs/ko/CONTRIBUTING.md', '.github/ISSUE_TEMPLATE/bug_report_en.md', '.github/ISSUE_TEMPLATE/feature.md']) {
    assert.equal(lowRisk([{ ...files[0], filename }], 1, repository), true);
  }
  for (const filename of ['SECURITY.md', 'CODEOWNERS', '.github/CODEOWNERS', 'docs/AI-CODE-REVIEW.md', '.github/workflows/ci.yml', '.github/ISSUE_TEMPLATE/config.yml', 'docs/example.md', 'assets/agent-family.svg']) {
    assert.equal(lowRisk([{ ...files[0], filename }], 1, repository), false);
  }
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

test('allows ordinary source and additive tests only under known product paths', () => {
  assert.equal(lowRisk(files, 1), true);
  assert.equal(lowRisk([{ ...files[0], filename: 'src/main.ts' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'src/main.ts' }], 1, target.repository), true);
  assert.equal(lowRisk([{ ...files[0], filename: 'site/components/button.tsx' }], 1, target.repository), true);
  assert.equal(lowRisk([{ ...files[0], filename: 'src/auth/session.ts' }], 1, target.repository), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'site/app/next.config.ts' }], 1, target.repository), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'site/test/browser.mjs' }], 1, target.repository), false);
  assert.equal(lowRisk([{ filename: 'site/test/browser.mjs', status: 'modified', patch: '@@ -1 +1,2 @@\n existing\n+assert.ok(true)' }], 1, target.repository), true);
  assert.equal(lowRisk([{ filename: 'site/test/browser.mjs', status: 'added', patch: '@@ -0,0 +1 @@\n+test.skip("disabled")' }], 1, target.repository), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'docs/AGENTS.md' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: '.github/workflows/ci.yml' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'tests/a.test.ts' }], 1), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'tests/a.test.ts', status: 'added' }], 1), false);
  assert.equal(lowRisk(files, 2), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'dist/app.js' }], 1, 'Oddmash/oddmash-website'), true);
  assert.equal(lowRisk([{ ...files[0], filename: 'dist/auth.js' }], 1, 'Oddmash/oddmash-website'), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'docs/deployment.md' }], 1, 'Oddmash/oddmash-agents'), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'skills/example/SKILL.md' }], 1, 'Oddmash/oddmash-skills'), false);
  assert.equal(lowRisk([{ ...files[0], filename: 'packages/runtime/src/client.ts' }], 1, 'Oddmash/boundra'), true);
  assert.equal(lowRisk([{ filename: 'packages/runtime/tests/client.test.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+assert.ok(true)' }], 1, 'Oddmash/boundra'), true);
  assert.equal(lowRisk([{ ...files[0], filename: 'crates/rules/src/lib.rs' }], 1, 'Oddmash/boundra'), false);
  assert.equal(protectedBranch(branch, base), true);
  assert.equal(protectedBranch({ ...branch, protected: false }, base), false);
});

test('mint write token only after exact-head approval and protected current CI', async () => {
  let writes = 0;
  let mints = 0;
  const makeApi = (passing = true, pull = pr, skippedVerify = false, boundraMatrix = false) => githubApi('fixture-token', async (input, init) => {
    const url = String(input);
    if (url.endsWith('/pulls/10')) return Response.json(pull);
    if (url.endsWith('/issues/9')) return Response.json(issue);
    if (url.includes('/files?')) return Response.json(files);
    if (url.endsWith('/branches/' + pull.base.ref)) return Response.json(branch);
    if (url.includes('/compare/')) return Response.json({ behind_by: 0, merge_base_commit: { sha: base } });
    if (url.includes('/reviews?')) return Response.json([{ id: 5, user: { login: 'oddmash-reviewer[bot]', id: 100 }, state: 'APPROVED', commit_id: head }]);
    if (url.includes('/check-runs?')) {
      const check_runs = [{ id: 1, name: 'verify', app: { id: 15368 }, status: 'completed', conclusion: passing ? 'success' : 'failure' }, ...(skippedVerify ? [{ id: 2, name: 'verify', app: { id: 15368 }, status: 'completed', conclusion: 'skipped' }] : [])];
      if (boundraMatrix) for (const name of ['verify-example', 'verify-runtime (20)', 'verify-runtime (22)', 'verify-runtime (24)', 'verify-cli-platforms (ubuntu-24.04)', 'verify-cli-platforms (macos-15)', 'verify-cli-platforms (macos-15-intel)', 'verify-cli-platforms (windows-2025)', 'benchmark-smoke']) check_runs.push({ id: check_runs.length + 1, name, app: { id: 15368 }, status: 'completed', conclusion: 'success' });
      return Response.json({ total_count: check_runs.length, check_runs });
    }
    if (url.endsWith('/status')) return Response.json({ total_count: 0, state: 'pending', statuses: [] });
    if (url.endsWith('/merge')) { writes++; assert.deepEqual(JSON.parse(String(init?.body)), { sha: head, merge_method: 'merge' }); return Response.json({ merged: true }); }
    if (url.endsWith('/installation/token')) return new Response(null, { status: 204 });
    throw new Error('Unexpected fixture request');
  });
  const mint = async () => { mints++; return makeApi(); };
  assert.equal(await mergeAuthorized(makeApi(false), target, candidate, 'oddmash-reviewer[bot]', 5, true, mint), false);
  assert.equal(await mergeAuthorized(makeApi(), target, candidate, 'oddmash-reviewer[bot]', 5, false, mint), false);
  assert.equal(await mergeAuthorized(makeApi(true, pr, true), target, candidate, 'oddmash-reviewer[bot]', 5, true, mint), false);
  assert.equal(mints, 0);
  assert.equal(await mergeAuthorized(makeApi(), target, candidate, 'oddmash-reviewer[bot]', 5, true, mint), true);
  assert.equal(mints, 1);
  assert.equal(writes, 1);
  const privateTarget = { installation: 1, repository: 'Oddmash/oddmash-website', repositoryId: 1468561714, private: true };
  const identity = { id: privateTarget.repositoryId, full_name: privateTarget.repository };
  const privatePull = { ...pr, head: { sha: head, repo: identity }, base: { ...pr.base, repo: { ...identity, default_branch: 'main', private: true } } };
  const privateCandidate = { ...candidate, pull: privatePull };
  assert.equal(await mergeAuthorized(makeApi(false, privatePull), privateTarget, privateCandidate, 'oddmash-reviewer[bot]', 5, true, mint), false);
  assert.equal(mints, 1);
  assert.equal(await mergeAuthorized(makeApi(true, privatePull), privateTarget, privateCandidate, 'oddmash-reviewer[bot]', 5, true, mint), true);
  assert.equal(mints, 2);
  assert.equal(writes, 2);
  const boundraTarget = { installation: 1, repository: 'Oddmash/boundra', repositoryId: 1218645367 };
  const boundraIdentity = { id: boundraTarget.repositoryId, full_name: boundraTarget.repository };
  const boundraPull = { ...pr, head: { sha: head, repo: boundraIdentity }, base: { ...pr.base, repo: { ...boundraIdentity, default_branch: 'main', private: false } } };
  const boundraCandidate = { ...candidate, pull: boundraPull };
  assert.equal(await mergeAuthorized(makeApi(true, boundraPull), boundraTarget, boundraCandidate, 'oddmash-reviewer[bot]', 5, true, mint), false);
  assert.equal(mints, 2);
  assert.equal(await mergeAuthorized(makeApi(true, boundraPull, false, true), boundraTarget, boundraCandidate, 'oddmash-reviewer[bot]', 5, true, mint), true);
  assert.equal(mints, 3);
  assert.equal(writes, 3);
  const developPull = { ...pr, base: { ...pr.base, ref: 'develop' } };
  const developCandidate = { ...candidate, pull: developPull };
  assert.equal(await mergeAuthorized(makeApi(true, developPull), target, candidate, 'oddmash-reviewer[bot]', 5, true, mint), false);
  assert.equal(await mergeAuthorized(makeApi(true, developPull), target, developCandidate, 'oddmash-reviewer[bot]', 5, true, mint), true);
  assert.equal(mints, 4);
  assert.equal(writes, 4);
});


test('configuration and permission changes remain ineligible for automatic merge', () => {
  for (const filename of ['.github/workflows/ci.yml', 'vercel.json', 'tsconfig.json', 'next.config.ts', 'Dockerfile', 'src/auth/session.ts', 'src/authorization/permissions.ts']) {
    assert.equal(lowRisk([{ filename, status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }], 1, 'Oddmash/kowrap'), false);
  }
});


test('automatic merge diagnostics distinguish repository scope, budget, evidence and operations', () => {
  const file = { filename: 'src/core.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' };
  const agent = 'Oddmash/oddmash-agents';
  assert.equal(lowRiskReason([file], 1, agent), 'repository requires root README-only changes');
  assert.equal(lowRiskReason([{ ...file, filename: 'README.md' }], 1, agent), undefined);
  assert.equal(lowRiskReason([file], 2, target.repository), 'changed-file list is incomplete');
  assert.equal(lowRiskReason([{ ...file, patch: 'x'.repeat(45_001) }], 1, target.repository), 'changed diff exceeds the auto-merge budget');
  assert.equal(lowRiskReason([{ ...file, patch: undefined }], 1, target.repository), 'changed diff evidence is incomplete');
  assert.equal(lowRiskReason([{ ...file, status: 'renamed', previous_filename: 'src/old.ts' }], 1, target.repository), 'changed file operation requires manual merge');
  assert.equal(lowRiskReason([{ ...file, filename: 'src/auth/session.ts' }], 1, target.repository), 'protected changed path requires manual merge');
  assert.equal(lowRiskReason([{ ...file, filename: 'tests/a.test.ts' }], 1, target.repository), 'changed test path is outside automatic merge scope');
});
