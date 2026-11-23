import test from 'node:test';
import assert from 'node:assert/strict';
import { finalReviewEvent, loadCheckEvidence, reviewChecksReady } from '../src/checks.ts';

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
