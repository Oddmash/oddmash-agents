import test from 'node:test';
import assert from 'node:assert/strict';
import { executionContext, executionRole, publicationRecorder, recordSkippedExecution, recordReviewPhase, runAgentExecution } from '../apps/worker/src/agent-execution.ts';

test('retries preserve correlation but keep roles separate', () => {
  const delivery = '12345678-1234-1234-1234-123456789012';
  const context = executionContext('reviewer', delivery);
  assert.equal(executionContext('reviewer', delivery, 2).correlationId, context.correlationId);
  assert.notEqual(executionContext('qa', delivery).correlationId, context.correlationId);
  assert.equal(executionRole({ advisory: 'qa' }), 'qa');
  assert.equal(executionRole({ impact: true }), 'impact');
  assert.equal(executionRole({}), 'reviewer');
  assert.ok(!JSON.stringify(context).includes(delivery));
});

test('execution records outcome without logging raw errors or result payloads', async () => {
  const context = executionContext('qa', '', 2);
  const events: unknown[] = [];
  const emit = (event: unknown) => { events.push(event); };
  let now = 100;
  assert.equal(await runAgentExecution(context, async () => 'private result', emit, () => now++), 'private result');
  const error = new Error('private detail');
  await assert.rejects(runAgentExecution(context, async () => { throw error; }, emit, () => now++), error);
  assert.equal(events.length, 4);
  const serialized = JSON.stringify(events);
  assert.match(serialized, /"outcome":"returned"/);
  assert.match(serialized, /"failure":"unexpected"/);
  assert.match(serialized, /"retryCount":1/);
  assert.match(serialized, /"durationMs":1/);
  assert.doesNotMatch(serialized, /private result|private detail/);
});

test('execution scopes and phases are emitted only from real worker lifecycle', async () => {
  const events: unknown[] = [];
  const context = executionContext('reviewer', '', 1, { repository: 'Oddmash/example', number: 7 });
  await runAgentExecution(context, async () => {
    recordReviewPhase('Collecting review context');
    recordReviewPhase('unrecognized fixture-private-detail');
  }, event => events.push(event));
  assert.equal(events.length, 3);
  assert.match(JSON.stringify(events), /"phase":"collecting-context"/);
  assert.match(JSON.stringify(events), /"repository":"Oddmash\/example"/);
  assert.doesNotMatch(JSON.stringify(events), /fixture-private-detail/);
  assert.equal(executionContext('reviewer', '', 1, { repository: 'Oddmash/example', number: 7, private: true }).target, undefined);
});


test('observational publication and explicit skips retain only the validated public target', async () => {
  const target = { repository: 'Oddmash/example', number: 7 };
  const context = executionContext('reviewer', '', 1, target);
  const child = executionContext('qa', '', 1, target);
  const events: import('../packages/operator-contract/src/index.ts').ExecutionEvent[] = [];
  const emit = (event: typeof events[number]) => events.push(event);
  let now = 100;
  await runAgentExecution(context, async () => {
    recordSkippedExecution('impact', target, 'excluded');
    recordSkippedExecution('architect', { ...target, private: true }, 'excluded');
    const ownPublication = publicationRecorder(target);
    ownPublication('review', 23);
    ownPublication('review', -1);
    publicationRecorder({ ...target, number: 8 })('review', 999);
    publicationRecorder({ ...target, private: true })('review', 777);
    const publishAfter = await runAgentExecution(child, async () => publicationRecorder(target), emit, () => now++);
    publishAfter('inline-comment', 123);
  }, emit, () => now++);
  const skips = events.filter(event => event.outcome === 'skipped');
  assert.equal(skips.length, 1);
  assert.equal(skips[0].role, 'impact');
  assert.equal(skips[0].skipReason, 'excluded');
  assert.deepEqual(skips[0].target, target);
  const publications = events.filter(event => event.outcome === 'published');
  assert.equal(publications.length, 2);
  assert.equal(publications[0].correlationId, context.correlationId);
  assert.equal(publications[1].correlationId, child.correlationId);
  assert.deepEqual(publications[1].publication, { kind: 'inline-comment', id: 123 });
  assert.equal(publications[1].role, 'qa');
});

test('unattributed parent publishes an independent observation for each verified public target', async () => {
  const context = executionContext('reviewer', '');
  const events: import('../packages/operator-contract/src/index.ts').ExecutionEvent[] = [];
  let now = 100;
  await runAgentExecution(context, async () => {
    publicationRecorder({ repository: 'Oddmash/example', number: 7 })('review', 23);
    publicationRecorder({ repository: 'Oddmash/example', number: 8 })('review', 24);
  }, event => events.push(event), () => now++);
  const publications = events.filter(event => event.outcome === 'published');
  assert.equal(publications.length, 2);
  assert.notEqual(publications[0].correlationId, context.correlationId);
  assert.notEqual(publications[0].correlationId, publications[1].correlationId);
  assert.deepEqual(publications.map(event => event.target?.number), [7, 8]);
});
