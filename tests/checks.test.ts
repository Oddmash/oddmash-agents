import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWaitingSummary, finalReviewEvent, loadCheckEvidence, publicReviewCheckReader, reviewChecksReady, reviewChecksSuccessful, shouldReconcilePendingChecks } from '../src/checks.ts';

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
