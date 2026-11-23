import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewJob, verifyReviewJob, retryableJobError, retryDelay } from '../src/review-job.ts';

test('queue messages authenticate exact target and delivery without storing credentials', () => {
  const delivery = '12345678-1234-1234-1234-123456789abc';
  const target = { installation: 1, repository: 'Oddmash/example', repositoryId: 2, number: 3, expectedHead: 'a'.repeat(40) };
  const job = createReviewJob(delivery, target, 'synthetic-secret');
  assert.equal(verifyReviewJob(job, 'synthetic-secret'), true);
  assert.equal(verifyReviewJob({ ...job, target: { ...target, number: 4 } }, 'synthetic-secret'), false);
  assert.equal(verifyReviewJob(job, 'different'), false);
  assert.doesNotMatch(JSON.stringify(job), /synthetic-secret/);
  assert.throws(() => createReviewJob('invalid', target, 'synthetic-secret'));
});

test('queue retries transient errors but not quota or authorization errors', () => {
  assert.equal(retryableJobError(new Error('GitHub request failed (503)')), true);
  assert.equal(retryableJobError(new Error('Mergeability evidence pending')), true);
  assert.equal(retryableJobError(new Error('GitHub request failed (403)')), false);
  assert.equal(retryableJobError(new Error('Model quota, rate or credit limit reached; stop and check API billing before retrying')), false);
  assert.equal(retryDelay(1), 15);
  assert.equal(retryDelay(10), 300);
});
