import { leadDeliveryKey } from '../apps/worker/src/review-job.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewJob, verifyReviewJob, retryableJobError, retryDelay, publishFailureRecord } from '../apps/worker/src/review-job.ts';

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

test('failure record publishing retries only the publication once', async () => {
  let calls = 0;
  const reports: string[] = [];
  await publishFailureRecord(async () => {
    if (++calls === 1) throw new Error('temporary queue failure');
  }, message => reports.push(message));
  assert.equal(calls, 2);
  assert.deepEqual(reports, []);
});

test('terminal failure record publishing reports a sanitized signal and stops review replay', async () => {
  let calls = 0;
  const reports: string[] = [];
  await assert.rejects(publishFailureRecord(async () => {
    calls++;
    throw new Error('private fixture value');
  }, message => reports.push(message)), /Reviewer failure record unavailable/);
  assert.equal(calls, 2);
  assert.deepEqual(reports, ['Reviewer failure record unavailable after two publish attempts']);
  assert.equal(retryableJobError(new Error('Reviewer failure record unavailable')), false);
});

test('model input budget excess is permanent and is not retried', () => {
  assert.equal(retryableJobError(new Error('Model input budget exceeded')), false);
});

test('slash delivery deduplication follows the source comment across redeliveries', () => {
  const target = { installation: 1, repository: 'Oddmash/example', repositoryId: 2, requestComment: { id: 3, kind: 'issue' as const, slash: true as const } };
  assert.equal(leadDeliveryKey(target, 'delivery-one'), leadDeliveryKey(target, 'delivery-two'));
  assert.notEqual(leadDeliveryKey(target, 'delivery-one'), leadDeliveryKey({ ...target, requestComment: { ...target.requestComment, id: 4 } }, 'delivery-one'));
  assert.equal(leadDeliveryKey({ ...target, requestComment: undefined }, 'delivery-one'), 'delivery-one');
});
