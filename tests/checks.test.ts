import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCheckEvidence } from '../src/checks.ts';

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
