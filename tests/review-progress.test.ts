import test from 'node:test';
import assert from 'node:assert/strict';
import { progressCheckName, startReviewProgress } from '../src/review-progress.ts';
import { loadCheckEvidence } from '../src/checks.ts';

test('progress is head-scoped and updates a single check', async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const api = async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    return { id: 42 } as T;
  };
  const head = 'a'.repeat(40);
  const progress = await startReviewProgress(api, 'Oddmash/example', head);
  await progress.update('Reviewing', '2 files');
  await progress.finish('neutral', 'Maintainer review needed');
  await progress.finish('failure', 'Duplicate');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.head_sha, head);
  assert.equal(calls[0].body.status, 'queued');
  assert.equal(calls[1].path, '/repos/Oddmash/example/check-runs/42');
  assert.equal(calls[1].body.status, 'in_progress');
  assert.equal(calls[2].body.conclusion, 'neutral');
});

test('only the identified reviewer progress check is excluded', async () => {
  const check = { name: progressCheckName, status: 'in_progress', conclusion: null };
  const evidence = await loadCheckEvidence('a'.repeat(40), null, async () => ({ total_count: 3, check_runs: [{ ...check, app: { id: 42 } }, { ...check, app: { id: 43 } }] }), 42);
  assert.equal(evidence.total_count, 2);
  assert.deepEqual(evidence.check_runs, [{ ...check, app: { id: 43 } }]);
});

test('failed progress publication does not interrupt review processing', async () => {
  let attempts = 0;
  const api = async <T>(): Promise<T> => { attempts++; throw new Error('Permission denied'); };
  const progress = await startReviewProgress(api, 'Oddmash/example', 'a'.repeat(40));
  await progress.update('Reviewing', '2 files');
  await progress.finish('success', 'Review approved');
  assert.equal(attempts, 1);
});
