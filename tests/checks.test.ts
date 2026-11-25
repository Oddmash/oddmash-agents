import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWaitingSummary, finalReviewEvent, loadCheckEvidence, publicReviewCheckReader, reviewChecksAreScopedAdvisory, reviewChecksMayStart, reviewChecksReady, reviewChecksSuccessful, scopedAdvisoryNote, shouldReconcilePendingChecks, type Check, type CheckEvidence } from '../apps/worker/src/checks.ts';

test('superseded cancellation, including failed aggregate and retired jobs, does not block current public PR checks', async () => {
  const head = 'a'.repeat(40);
  const oldRun = { head_sha: head, workflow_id: 1, check_suite_id: 10, run_number: 125, event: 'pull_request', status: 'completed', conclusion: 'cancelled', pull_requests: [{ number: 51 }] };
  const current = { ...oldRun, check_suite_id: 11, run_number: 126, conclusion: 'success' };
  const job = (suite: number, name: string, conclusion: string, app = 15368) => ({ name, status: 'completed', conclusion, app: { id: app }, check_suite: { id: suite } });
  const oldJobs = [job(10, 'verify', 'failure'), job(10, 'retired matrix job', 'cancelled')];
  const currentJobs = [job(11, 'verify', 'success'), job(11, 'new matrix job', 'success')];
  const evaluate = (check_runs: ReturnType<typeof job>[], workflow_runs: typeof oldRun[], total_count = workflow_runs.length) => {
    const read = publicReviewCheckReader('/repos/Oddmash/example', 51, async () => ({ check_runs, total_count: check_runs.length }), async (url, init) => {
      assert.equal(new URL(String(url)).searchParams.get('head_sha'), head);
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return Response.json({ workflow_runs, total_count });
    });
    return loadCheckEvidence(head, null, read, 42);
  };
  const passing = await evaluate([...oldJobs, ...currentJobs], [oldRun, current]);
  assert.deepEqual(passing.check_runs, currentJobs);
  assert.equal(reviewChecksSuccessful(passing), true);
  const pending = await evaluate(oldJobs, [oldRun, { ...current, status: 'queued' }]);
  assert.equal(shouldReconcilePendingChecks(pending, head, head, true), true);
  assert.equal(shouldReconcilePendingChecks(pending, 'b'.repeat(40), head, true), false);
  assert.match(checkWaitingSummary(pending), /current workflow is still running/);
  const noJobsYet = await evaluate(oldJobs, [oldRun, current]);
  assert.equal(reviewChecksReady(noJobsYet), false);
  for (const runs of [
    [oldRun],
    [oldRun, { ...current, conclusion: 'failure' }],
    [oldRun, { ...current, conclusion: 'cancelled' }],
    [oldRun, { ...current, head_sha: 'b'.repeat(40) }],
    [oldRun, { ...current, pull_requests: [{ number: 52 }] }],
    [oldRun, { ...current, workflow_id: 2 }]
  ]) {
    assert.equal(reviewChecksSuccessful(await evaluate([...oldJobs, ...currentJobs], runs)), false);
  }
  assert.equal(reviewChecksSuccessful(await evaluate([...oldJobs, ...currentJobs], [oldRun, current], 3)), false);
  assert.equal(reviewChecksSuccessful(await evaluate([...oldJobs, ...currentJobs, job(20, 'verify', 'failure')], [oldRun, current])), false);
  assert.equal(reviewChecksSuccessful(await evaluate([...oldJobs, ...currentJobs, job(10, 'external check', 'failure', 99)], [oldRun, current])), false);
  assert.equal(reviewChecksSuccessful(await evaluate([...oldJobs, job(11, 'verify', 'failure')], [oldRun, current])), false);
});

test('fork workflow runs with empty associations require a unique matching PR across branch history', async () => {
  const sha = 'a'.repeat(40);
  const head = { sha, ref: 'fix/example', repo: { id: 123, owner: { login: 'contributor' } } };
  const pr = { number: 51, head };
  const job = (id: number, conclusion: string) => ({ name: 'verify', status: 'completed', conclusion, app: { id: 15368 }, check_suite: { id } });
  const check_runs = [job(10, 'failure'), job(11, 'success')];
  const cancelled = { head_sha: sha, head_branch: head.ref, head_repository: { id: 123 }, event: 'pull_request', workflow_id: 1,
    check_suite_id: 10, run_number: 125, status: 'completed', conclusion: 'cancelled', pull_requests: [] as { number: number }[] };
  const replacement = { ...cancelled, check_suite_id: 11, run_number: 126, conclusion: 'success' };
  const evaluate = async (pulls: typeof pr[] | null, workflow = replacement) => {
    const read = publicReviewCheckReader('/repos/Oddmash/example', 51, async () => ({ check_runs, total_count: 2 }),
      async () => Response.json({ total_count: 2, workflow_runs: [cancelled, workflow] }), {
        head,
        readPulls: async path => {
          const url = new URL(path, 'https://api.github.com');
          assert.equal(url.pathname, '/repos/Oddmash/example/pulls');
          assert.equal(url.searchParams.get('head'), 'contributor:fix/example');
          assert.equal(url.searchParams.get('state'), 'all');
          assert.equal(url.searchParams.get('per_page'), '2');
          return pulls;
        },
      });
    return reviewChecksSuccessful((await read(sha))!);
  };
  assert.equal(await evaluate([pr]), true);
  assert.equal(await evaluate([pr, { ...pr, number: 52 }]), false);
  assert.equal(await evaluate([{ ...pr, number: 52 }]), false);
  assert.equal(await evaluate([{ ...pr, head: { ...head, sha: 'b'.repeat(40) } }]), false);
  assert.equal(await evaluate(null), false);
  assert.equal(await evaluate([pr], { ...replacement, head_repository: { id: 124 } }), false);
  assert.equal(await evaluate([pr], { ...replacement, head_branch: 'other' }), false);
  assert.equal(await evaluate([pr], { ...replacement, pull_requests: [{ number: 52 }] }), false);
});

test('only final aggregate CI evidence can produce an official review', () => {
  const label = { name: 'labels', status: 'completed', conclusion: 'success' };
  const verify = { name: 'verify', status: 'completed', conclusion: 'success', app: { id: 15368 } };
  const early = { total_count: 1, check_runs: [label] };
  assert.equal(reviewChecksReady(early), false);
  assert.equal(finalReviewEvent('APPROVE', early), null);
  assert.equal(finalReviewEvent('COMMENT', early), null);
  const finished = { total_count: 2, check_runs: [label, verify] };
  assert.equal(finalReviewEvent('APPROVE', finished), 'APPROVE');
  assert.equal(finalReviewEvent('COMMENT', finished), 'COMMENT');
  assert.equal(finalReviewEvent('APPROVE', { ...finished, total_count: 3 }), null);
  const failed = { total_count: 2, check_runs: [label, { ...verify, conclusion: 'failure' }] };
  assert.equal(finalReviewEvent('APPROVE', failed), null);
  assert.equal(finalReviewEvent('REQUEST_CHANGES', failed), 'REQUEST_CHANGES');
});

test('reads both current head and generated merge commit evidence for fork PRs', async () => {
  const head = 'a'.repeat(40), merge = 'b'.repeat(40);
  const seen: string[] = [];
  const evidence = await loadCheckEvidence(head, merge, async sha => {
    seen.push(sha);
    return sha === head ? { check_runs: [], total_count: 0 } : { check_runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }], total_count: 1 };
  });
  assert.deepEqual(seen, [head, merge]);
  assert.equal(evidence.total_count, 1);
  assert.equal(evidence.check_runs[0].name, 'CI');
});

test('does not approve when any aggregate verify check is skipped or cancelled', () => {
  const verify = { name: 'verify', status: 'completed', conclusion: 'success', app: { id: 15368 } };
  for (const conclusion of ['skipped', 'cancelled']) {
    assert.equal(finalReviewEvent('APPROVE', { total_count: 2, check_runs: [verify, { ...verify, conclusion }] }), null);
  }
});

test('pending CI reconciliation is opt-in and bound to the expected head', () => {
  const head = 'a'.repeat(40);
  const pending = { total_count: 1, check_runs: [{ name: 'verify', status: 'queued', conclusion: null, app: { id: 15368 } }] };
  const missing = { total_count: 0, check_runs: [] };
  const failed = { total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'failure', app: { id: 15368 } }] };
  const passed = { total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'success', app: { id: 15368 } }] };
  for (const evidence of [pending, missing]) {
    assert.equal(shouldReconcilePendingChecks(evidence, head, head, true), true);
    assert.equal(shouldReconcilePendingChecks(evidence, undefined, head, true), false);
    assert.equal(shouldReconcilePendingChecks(evidence, 'b'.repeat(40), head, true), false);
    assert.equal(shouldReconcilePendingChecks(evidence, head, head, false), false);
    assert.equal(reviewChecksSuccessful(evidence), false);
  }
  assert.equal(shouldReconcilePendingChecks(failed, head, head, true), false);
  assert.equal(shouldReconcilePendingChecks(passed, head, head, true), false);
  assert.equal(reviewChecksSuccessful(failed), false);
  assert.equal(reviewChecksSuccessful(passed), true);
});

test('unavailable check evidence is not successful even if another ref passed', async () => {
  const result = await loadCheckEvidence('a'.repeat(40), 'b'.repeat(40), async sha => sha.startsWith('a') ? null : { total_count: 1, check_runs: [{ name: 'verify', status: 'completed', conclusion: 'success' }] });
  assert.equal(reviewChecksSuccessful(result), false);
});

test('Boundra requires every trusted matrix job and the aggregate verify gate', () => {
  const repository = 'Oddmash/boundra';
  const names = [
    'verify-example', 'verify-runtime (20)', 'verify-runtime (22)', 'verify-runtime (24)',
    'verify-cli-platforms (ubuntu-24.04)', 'verify-cli-platforms (macos-15)',
    'verify-cli-platforms (macos-15-intel)', 'verify-cli-platforms (windows-2025)', 'benchmark-smoke', 'verify'
  ];
  const jobs = names.map((name, index) => ({ name: index % 2 ? `Boundra / ${name}` : name, status: 'completed', conclusion: 'success', app: { id: 15368 } }));
  const full = { total_count: jobs.length, check_runs: jobs };
  assert.equal(reviewChecksSuccessful(full, repository), true);
  assert.equal(finalReviewEvent('APPROVE', full, repository), 'APPROVE');
  const profileOnly = { total_count: jobs.length - 1, check_runs: jobs.slice(0, -1) };
  assert.equal(reviewChecksReady(profileOnly, repository), false);
  assert.equal(reviewChecksSuccessful(profileOnly, repository), false);
  assert.equal(finalReviewEvent('APPROVE', profileOnly, repository), null);
  assert.equal(reviewChecksSuccessful(profileOnly), false);
  for (const conclusion of ['failure', 'skipped', 'cancelled']) {
    const aggregateFailed = { total_count: jobs.length, check_runs: [...jobs.slice(0, -1), { ...jobs.at(-1)!, conclusion }] };
    assert.equal(reviewChecksSuccessful(aggregateFailed, repository), false);
    assert.equal(finalReviewEvent('APPROVE', aggregateFailed, repository), null);
  }
  assert.equal(reviewChecksReady({ total_count: jobs.length, check_runs: [...jobs.slice(0, -1), { ...jobs.at(-1)!, app: undefined }] }, repository), false);
  const missing = { total_count: jobs.length - 1, check_runs: jobs.slice(1) };
  assert.equal(reviewChecksReady(missing, repository), false);
  assert.equal(finalReviewEvent('APPROVE', missing, repository), null);
  const head = 'a'.repeat(40);
  assert.equal(shouldReconcilePendingChecks(missing, head, head, true, repository), true);
  assert.equal(shouldReconcilePendingChecks(full, head, head, true, repository), false);
  for (const conclusion of ['failure', 'skipped', 'cancelled']) {
    const failed = { total_count: jobs.length, check_runs: [{ ...jobs[0], conclusion }, ...jobs.slice(1)] };
    assert.equal(reviewChecksReady(failed, repository), true);
    assert.equal(finalReviewEvent('APPROVE', failed, repository), null);
  }
  for (const replacement of [{ ...jobs[0], app: { id: 42 } }, { ...jobs[0], app: undefined }, { ...jobs[0], name: 'Another workflow / verify-example' }]) {
    assert.equal(reviewChecksReady({ total_count: jobs.length, check_runs: [replacement, ...jobs.slice(1)] }, repository), false);
  }
  assert.equal(reviewChecksReady({ ...full, total_count: jobs.length + 1 }, repository), false);
  assert.equal(reviewChecksReady({ ...full, check_runs: [{ ...jobs[0], status: 'queued', conclusion: null }, ...jobs.slice(1)] }, repository), false);
});

test('default verify gate requires the trusted GitHub Actions app identity', () => {
  const verify = { name: 'verify', status: 'completed', conclusion: 'success' };
  for (const app of [undefined, { id: 42 }]) {
    const evidence = { total_count: 1, check_runs: [{ ...verify, app }] };
    assert.equal(reviewChecksReady(evidence), false);
    assert.equal(reviewChecksSuccessful(evidence), false);
    assert.equal(finalReviewEvent('APPROVE', evidence), null);
  }
  assert.equal(reviewChecksSuccessful({ total_count: 1, check_runs: [{ ...verify, app: { id: 15368 } }] }), true);
});

test('waiting diagnostics distinguish missing, running, failed and incomplete checks without changing gates', () => {
  const check = { name: 'labels', status: 'queued', conclusion: null };
  const summary = checkWaitingSummary({ total_count: 3, check_runs: [check, { ...check, status: 'completed', conclusion: 'failure' }] });
  assert.match(summary, /evidence is incomplete/);
  assert.match(summary, /required check group/);
  assert.match(summary, /still running or queued/);
  assert.match(summary, /did not pass/);
  assert.match(summary, /Checks/);
  assert.doesNotMatch(summary, /labels/);
});

test('maintainer actionable findings remain neutral without approving, while other authors still get change requests', () => {
  const owner = { id: 135234546, login: 'qtaghdi' };
  const verify = { name: 'verify', status: 'completed', conclusion: 'success', app: { id: 15368, slug: 'github-actions' } };
  const passed = { total_count: 1, check_runs: [verify] };
  assert.equal(finalReviewEvent('REQUEST_CHANGES', passed, undefined, owner), 'COMMENT');
  assert.equal(finalReviewEvent('REQUEST_CHANGES', passed, undefined, { ...owner, login: 'other' }), 'REQUEST_CHANGES');
  assert.equal(finalReviewEvent('REQUEST_CHANGES', passed, undefined, { ...owner, id: 1 }), 'REQUEST_CHANGES');
  assert.equal(finalReviewEvent('REQUEST_CHANGES', passed), 'REQUEST_CHANGES');
  assert.equal(finalReviewEvent('APPROVE', passed, undefined, owner), 'APPROVE');
  const failed = { total_count: 1, check_runs: [{ ...verify, conclusion: 'failure' }] };
  assert.equal(finalReviewEvent('REQUEST_CHANGES', failed, undefined, owner), 'COMMENT');
  assert.equal(finalReviewEvent('APPROVE', failed, undefined, owner), null);
  assert.equal(finalReviewEvent('REQUEST_CHANGES', { total_count: 1, check_runs: [{ ...verify, status: 'in_progress', conclusion: null }] }, undefined, owner), null);
});

const scopedRepository = 'Oddmash/boundra';
const scopedHead = 'a'.repeat(40);
const scopedMerge = 'b'.repeat(40);
const scopedNumber = 126;
const scopedRepoId = 1218645367;
const scopedBranch = 'fix/site';
const scopedBlobs: Record<string, string> = {
  '.github/workflows/boundra.yml': '111d1bc79cebd2d8223b7587af35deee4f35f8a3',
  'scripts/classify-ci-scope.mjs': '4f941d29489a3fc007e9285f87b4d6a369e441b2',
  'scripts/classify-ci-scope.test.mjs': '44adee98496346c5e154b48d81263f9b5a284949',
  '.github/workflows/pages.yml': '3bb95fdf641880ada87f4bf2eadcd602886ccf88'
};
const scopeJob = (suite: number, name: string, conclusion: string, app = 15368): Check => ({
  name, status: 'completed', conclusion, app: { id: app }, check_suite: { id: suite }
});
const scopedJobs = [
  ...['scope', 'contribution / scope', 'verify'].map(name => scopeJob(10, name, 'success')),
  ...['verify-example', 'verify-runtime', 'verify-cli-platforms', 'benchmark-smoke', 'release-notes'].map(name => scopeJob(10, name, 'skipped')),
  scopeJob(11, 'validate', 'success'), scopeJob(11, 'deploy', 'skipped')
];
const scopedRuns = [296703178, 427973803].map((workflow_id, index) => ({
  workflow_id, check_suite_id: 10 + index, run_number: 213, head_sha: scopedHead, head_branch: scopedBranch,
  head_repository: { id: scopedRepoId }, event: 'pull_request', status: 'completed', conclusion: 'success',
  pull_requests: [{ number: scopedNumber }]
}));
const scopedSource = { head: { sha: scopedHead, ref: scopedBranch, repo: { id: scopedRepoId, owner: { login: 'Oddmash' } } },
  merge: scopedMerge, readPulls: async () => null };
const evaluateScoped = async ({
  jobs = scopedJobs, runs = scopedRuns, totalRuns = runs.length, blobs = scopedBlobs,
  source = scopedSource, second: secondEvidence = { total_count: 0, check_runs: [] }
}: { jobs?: Check[]; runs?: typeof scopedRuns; totalRuns?: number; blobs?: Record<string, string>; source?: typeof scopedSource; second?: CheckEvidence | null } = {}) => {
  const reader = publicReviewCheckReader('/repos/' + scopedRepository, scopedNumber, async ref =>
    ref === scopedHead ? { total_count: jobs.length, check_runs: jobs } : secondEvidence, async (url, init) => {
    const path = new URL(String(url));
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    if (path.pathname.endsWith('/actions/runs')) {
      assert.equal(path.searchParams.get('head_sha'), scopedHead);
      return Response.json({ total_count: totalRuns, workflow_runs: runs });
    }
    if (path.pathname.includes('/contents/')) {
      assert.equal(path.searchParams.get('ref'), scopedMerge);
      const file = path.pathname.split('/contents/')[1];
      return Response.json({ type: 'file', sha: blobs[file] });
    }
    assert.fail('Unexpected request');
  }, source);
  return loadCheckEvidence(scopedHead, scopedMerge, reader, 42);
};

test('Boundra site-only exact-head scoped CI can start only an advisory review; strict matrix gate is unchanged', async () => {
  const scoped = await evaluateScoped();
  assert.equal(reviewChecksMayStart(scoped, scopedRepository), true);
  assert.equal(reviewChecksAreScopedAdvisory(scoped, scopedRepository), true);
  assert.equal(reviewChecksReady(scoped, scopedRepository), false);
  assert.equal(reviewChecksSuccessful(scoped, scopedRepository), false);
  assert.equal(shouldReconcilePendingChecks(scoped, scopedHead, scopedHead, true, scopedRepository), false);
  for (const assessment of ['APPROVE', 'COMMENT', 'REQUEST_CHANGES'] as const) {
    assert.equal(finalReviewEvent(assessment, scoped, scopedRepository), 'COMMENT');
  }
  assert.match(scopedAdvisoryNote(scoped, scopedRepository), /advisory review only/);
  assert.equal(reviewChecksAreScopedAdvisory(scoped, 'Oddmash/other'), false);
  const raw = { total_count: scopedJobs.length, check_runs: scopedJobs };
  assert.equal(reviewChecksMayStart(raw, scopedRepository), false);
  assert.equal(finalReviewEvent('APPROVE', raw, scopedRepository), null);
  assert.equal(reviewChecksAreScopedAdvisory({ ...scoped }, scopedRepository), false);
});

test('Boundra verified CLI and runtime scopes start neutral review without full matrix approval', async () => {
  for (const notes of ['skipped', 'success']) {
    for (const cli of [true, false]) {
      const jobs = scopedJobs.filter(job => job.name !== (cli ? 'verify-cli-platforms' : 'verify-runtime')).map(job => {
        if (job.name === 'verify-example' || (cli && job.name === 'benchmark-smoke')) return { ...job, conclusion: 'success' };
        if (job.name === 'release-notes') return { ...job, conclusion: notes };
        return job;
      });
      const matrix = cli
        ? ['ubuntu-24.04', 'macos-15', 'macos-15-intel', 'windows-2025'].map(os => 'verify-cli-platforms (' + os + ')')
        : ['20', '22', '24'].map(node => 'verify-runtime (' + node + ')');
      jobs.push(...matrix.map(name => scopeJob(10, name, 'success')));
      const evidence = await evaluateScoped({ jobs });
      assert.equal(reviewChecksMayStart(evidence, scopedRepository), true);
      assert.equal(reviewChecksSuccessful(evidence, scopedRepository), false);
      assert.equal(finalReviewEvent('APPROVE', evidence, scopedRepository), 'COMMENT');
      assert.equal(shouldReconcilePendingChecks(evidence, scopedHead, scopedHead, true, scopedRepository), false);
      for (const name of matrix) {
        const incomplete = await evaluateScoped({ jobs: jobs.filter(job => job.name !== name) });
        assert.equal(reviewChecksMayStart(incomplete, scopedRepository), false);
        assert.equal(finalReviewEvent('APPROVE', incomplete, scopedRepository), null);
      }
    }
  }
});

test('Boundra scoped review selects the latest successful associated suite', async () => {
  const jobs = [...scopedJobs, ...scopedJobs.filter(job => job.check_suite?.id === 10).map(job => ({ ...job, check_suite: { id: 12 } }))];
  const runs = [...scopedRuns, { ...scopedRuns[0], run_number: 214, check_suite_id: 12 }];
  const evidence = await evaluateScoped({ jobs, runs });
  assert.equal(reviewChecksAreScopedAdvisory(evidence, scopedRepository), true);
  assert.equal(finalReviewEvent('APPROVE', evidence, scopedRepository), 'COMMENT');
  const incompleteLatest = await evaluateScoped({ jobs: jobs.filter(job => !(job.check_suite?.id === 12 && job.name === 'verify')), runs });
  assert.equal(reviewChecksMayStart(incompleteLatest, scopedRepository), false);
});

test('Boundra scoped review refuses missing, pending, untrusted or mixed suite evidence', async () => {
  const variations = [
    scopedJobs.slice(1),
    scopedJobs.slice(0, -1),
    scopedJobs.map(job => job.name === 'verify' ? { ...job, conclusion: 'skipped' } : job),
    scopedJobs.map(job => job.name === 'scope' ? { ...job, status: 'queued', conclusion: null } : job),
    scopedJobs.map(job => job.name === 'verify-runtime' ? { ...job, app: { id: 42 } } : job),
    scopedJobs.map(job => job.name === 'verify-cli-platforms' ? { ...job, check_suite: { id: 12 } } : job),
    scopedJobs.map(job => job.name === 'validate' ? { ...job, conclusion: 'skipped' } : job),
    [...scopedJobs, scopeJob(10, 'verify-runtime (20)', 'success')]
  ];
  for (const jobs of variations) {
    const evidence = await evaluateScoped({ jobs });
    assert.equal(reviewChecksMayStart(evidence, scopedRepository), false);
    assert.equal(finalReviewEvent('APPROVE', evidence, scopedRepository), null);
  }
  assert.equal(reviewChecksMayStart(await evaluateScoped({ second: null }), scopedRepository), false);
  assert.equal(reviewChecksMayStart(await evaluateScoped({ second: { check_runs: [] } }), scopedRepository), false);
  assert.equal(reviewChecksMayStart(await evaluateScoped({
    second: { total_count: 1, check_runs: [{ name: 'other', status: 'in_progress', conclusion: null }] }
  }), scopedRepository), false);
});

test('Boundra scoped review refuses superseded, ambiguous, unrelated and stale workflow contracts', async () => {
  const runVariations = [
    scopedRuns.slice(0, 1),
    scopedRuns.map(run => ({ ...run, head_sha: 'c'.repeat(40) })),
    scopedRuns.map(run => ({ ...run, pull_requests: [{ number: scopedNumber + 1 }] })),
    scopedRuns.map(run => ({ ...run, head_repository: { id: 123 } })),
    [...scopedRuns, { ...scopedRuns[0], run_number: 214, check_suite_id: 12, status: 'queued', conclusion: 'success' }],
    [...scopedRuns, { ...scopedRuns[0], run_number: 214, check_suite_id: 12, pull_requests: [] }],
    [...scopedRuns, { ...scopedRuns[0], check_suite_id: 12 }],
    scopedRuns.map(run => ({ ...run, conclusion: 'failure' }))
  ];
  for (const runs of runVariations) {
    assert.equal(reviewChecksMayStart(await evaluateScoped({ runs }), scopedRepository), false);
  }
  assert.equal(reviewChecksMayStart(await evaluateScoped({ totalRuns: 3 }), scopedRepository), false);
  for (const path of Object.keys(scopedBlobs)) {
    assert.equal(reviewChecksMayStart(await evaluateScoped({ blobs: { ...scopedBlobs, [path]: 'f'.repeat(40) } }), scopedRepository), false);
  }
  assert.equal(reviewChecksMayStart(await evaluateScoped({ source: { ...scopedSource, merge: '' } }), scopedRepository), false);
});
