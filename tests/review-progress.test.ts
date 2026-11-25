import test from 'node:test';
import assert from 'node:assert/strict';
import { progressCheckName, startReviewProgress } from '../apps/worker/src/review-progress.ts';
import { loadCheckEvidence } from '../apps/worker/src/checks.ts';

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

test('terminal publication can retry on the original check after failure', async () => {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    if (calls.length === 1) return { id: 42 } as T;
    if (calls.length === 3) throw new Error('Temporary failure');
    return {} as T;
  };
  const progress = await startReviewProgress(api, 'Oddmash/example', 'a'.repeat(40));
  await progress.update('Reviewing', '2 files');
  await progress.finish('success', 'Review approved');
  await progress.finish('success', 'Review approved');
  await progress.finish('success', 'Review approved');
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(1).every(call => call.path.endsWith('/42')));
  assert.deepEqual(calls.slice(2).map(call => call.body.status), ['completed', 'completed']);
});

test('waiting for CI is reused by the same PR, head, App and request', async () => {
  const head = 'a'.repeat(40);
  const identity = { appId: 42, number: 7 };
  let created: Record<string, unknown> | undefined;
  const patches: Record<string, unknown>[] = [];
  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    if (!init) return { total_count: created ? 1 : 0, check_runs: created ? [{ ...created, id: 12, app: { id: 42 } }] : [] } as T;
    if (init.method === 'POST') {
      assert.equal(created, undefined);
      created = JSON.parse(String(init.body));
      return { id: 12 } as T;
    }
    assert.equal(path, '/repos/Oddmash/example/check-runs/12');
    patches.push(JSON.parse(String(init.body)));
    return {} as T;
  };
  await startReviewProgress(api, 'Oddmash/example', head, { ...identity, waiting: true });
  assert.equal(created?.status, 'queued');
  assert.equal((created?.output as { title: string }).title, 'Waiting for CI');
  await startReviewProgress(api, 'Oddmash/example', head, { ...identity, waiting: true });
  const review = await startReviewProgress(api, 'Oddmash/example', head, identity);
  await review.update('Collecting changes', 'Starting review');
  await review.finish('success', 'Review approved');
  assert.deepEqual(patches.map(item => item.status), ['in_progress', 'completed']);
});

test('foreign runs and different PR/request identities are not reused', async () => {
  const head = 'a'.repeat(40);
  const identity = { appId: 42, number: 7, request: 'comment-5' };
  const matching = { id: 12, name: progressCheckName, head_sha: head, external_id: `oddmash-review:7:${head}:comment-5`, status: 'queued', app: { id: 42 } };
  const check_runs = [{ ...matching, app: { id: 43 } }, { ...matching, external_id: `oddmash-review:8:${head}:comment-5` }, { ...matching, external_id: `oddmash-review:7:${head}:initial` }, { ...matching, head_sha: 'b'.repeat(40) }, { ...matching, status: 'completed' }];
  let posts = 0;
  const api = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    if (!init) return { total_count: check_runs.length, check_runs } as T;
    assert.equal(init.method, 'POST');
    posts++;
    return { id: 42 } as T;
  };
  await startReviewProgress(api, 'Oddmash/example', head, { ...identity, reuseOnly: true });
  assert.equal(posts, 0);
  await startReviewProgress(api, 'Oddmash/example', head, identity);
  assert.equal(posts, 1);
});

test('incomplete progress lookup does not create duplicate runs', async () => {
  let calls = 0;
  const api = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    calls++;
    assert.equal(init, undefined);
    return { total_count: 2, check_runs: [] } as T;
  };
  const progress = await startReviewProgress(api, 'Oddmash/example', 'a'.repeat(40), { appId: 42, number: 7, waiting: true });
  await progress.update('Collecting', 'Example');
  assert.equal(calls, 1);
});

test('waiting progress displays supplied diagnostic without changing queued status', async () => {
  const calls: Record<string, unknown>[] = [];
  const api = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    if (!init) return { total_count: 0, check_runs: [] } as T;
    calls.push(JSON.parse(String(init.body)));
    return { id: 42 } as T;
  };
  await startReviewProgress(api, 'Oddmash/example', 'a'.repeat(40), { appId: 42, number: 7, waiting: true, waitingSummary: 'Missing verify. Open Checks.' });
  assert.equal(calls[0].status, 'queued');
  assert.deepEqual(calls[0].output, { title: 'Waiting for CI', summary: 'Missing verify. Open Checks.' });
});
