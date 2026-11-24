import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { successfulTests } from '../scripts/ci-evidence.mjs';

const input = {
  repository: 'Oddmash/oddmash-agents',
  head: 'a'.repeat(40),
  revision: 'b'.repeat(40),
  event: 'pull_request',
  branch: 'ci/example',
  headRepository: 123,
  currentRun: 100,
};
const successfulRun = {
  id: 99,
  run_attempt: 2,
  path: '.github/workflows/ci.yml',
  head_sha: input.head,
  head_branch: input.branch,
  event: input.event,
  head_repository: { id: input.headRepository },
  status: 'completed',
  conclusion: 'success',
};
const testJob = {
  name: 'test',
  status: 'completed',
  conclusion: 'success',
  steps: [{ name: `Record full test result for ${input.revision}`, conclusion: 'success' }],
};

test('reuses completed full tests on the exact workflow run attempt and revision', async () => {
  const calls: string[] = [];
  const run = await successfulTests(async (path: string) => {
    calls.push(path);
    return calls.length === 1 ? { workflow_runs: [successfulRun] } : { jobs: [testJob] };
  }, input);
  assert.equal(run, 99);
  assert.match(calls[0], /\/workflows\/ci\.yml\/runs\?event=pull_request&branch=ci%2Fexample&head_sha=/);
  assert.match(calls[1], /\/runs\/99\/attempts\/2\/jobs$/);
});

test('runs tests again for missing, reused, skipped or different merge-revision evidence', async () => {
  const candidates = [
    [],
    [{ ...testJob, steps: [] }],
    [{ ...testJob, conclusion: 'skipped' }],
    [{ ...testJob, steps: [{ ...testJob.steps[0], conclusion: 'skipped' }] }],
    [{ ...testJob, steps: [{ ...testJob.steps[0], name: `Record full test result for ${input.head}` }] }],
  ];
  for (const jobs of candidates) {
    assert.equal(await successfulTests(async (path: string) => path.endsWith('/jobs')
      ? { jobs } : { workflow_runs: [successfulRun] }, input), null);
  }
});

test('rejects another workflow, head, repository or running attempt and tolerates API failure', async () => {
  const runs = [
    { ...successfulRun, id: input.currentRun },
    { ...successfulRun, path: '.github/workflows/other.yml' },
    { ...successfulRun, head_sha: input.revision },
    { ...successfulRun, head_repository: { id: 456 } },
    { ...successfulRun, event: 'push' },
    { ...successfulRun, conclusion: 'failure' },
  ];
  const calls: string[] = [];
  assert.equal(await successfulTests(async (path: string) => {
    calls.push(path);
    return { workflow_runs: runs };
  }, input), null);
  assert.equal(calls.length, 1);
  assert.equal(await successfulTests(async () => { throw new Error('API unavailable'); }, input), null);
});

test('release evidence only comes from main push CI on the exact deployed commit', async () => {
  const release = { ...input, head: input.revision, event: 'push', branch: 'main' };
  const mainRun = { ...successfulRun, head_sha: release.head, head_branch: 'main', event: 'push' };
  assert.equal(await successfulTests(async (path: string) => path.endsWith('/jobs')
    ? { jobs: [testJob] } : { workflow_runs: [successfulRun, mainRun] }, release), 99);
  assert.equal(await successfulTests(async (path: string) => path.endsWith('/jobs')
    ? { jobs: [testJob] } : { workflow_runs: [successfulRun, { ...mainRun, head_branch: 'develop' }] }, release), null);
});
