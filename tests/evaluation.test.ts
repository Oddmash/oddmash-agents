import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAnchors } from '../src/evaluation.ts';

test('evaluation counts expected and unexpected anchors without duplicate inflation', () => {
  const right = { path: 'src/button.tsx', line: 8, side: 'RIGHT' as const };
  const left = { path: 'src/button.tsx', line: 8, side: 'LEFT' as const };
  const missed = { path: 'src/dialog.tsx', line: 12, side: 'RIGHT' as const };
  assert.deepEqual(evaluateAnchors([right, missed], [right, right, left]), { truePositive: 1, falsePositive: 1, falseNegative: 1, precision: 0.5, recall: 0.5 });
  assert.deepEqual(evaluateAnchors([], []), { truePositive: 0, falsePositive: 0, falseNegative: 0, precision: null, recall: null });
});
