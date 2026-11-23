import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsQuotaBlocked } from '../src/actions-quota.ts';

const check = {
  app: { id: 15368 },
  status: 'completed',
  conclusion: 'failure',
  output: { summary: 'The job was not started because recent account payments have failed or your spending limit needs to be increased.' }
};

test('recognizes explicit billing or quota evidence from Actions checks', () => {
  assert.equal(actionsQuotaBlocked([check]), true);
  assert.equal(actionsQuotaBlocked([{ ...check, output: { title: 'GitHub Actions runner minutes quota has been exceeded.' } }]), true);
  assert.equal(actionsQuotaBlocked([{ ...check, output: { title: 'The job was not started because the Actions budget has been reached.' } }]), true);
});

test('missing, unrelated and recovered check evidence does not prove a quota block', () => {
  for (const candidate of [
    { ...check, app: { id: 123 } },
    { ...check, app: undefined },
    { ...check, status: 'queued' },
    { ...check, conclusion: 'success' },
    { ...check, conclusion: 'skipped' },
    { ...check, output: undefined },
    { ...check, output: { summary: 'Unit test failed: quota' } },
    { ...check, output: { summary: 'The job was not started because the runner is offline.' } }
  ]) assert.equal(actionsQuotaBlocked([candidate]), false);
  assert.equal(actionsQuotaBlocked([]), false);
});
