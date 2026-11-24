import test from 'node:test';
import assert from 'node:assert/strict';
import { executionContext, executionRole, runAgentExecution } from '../src/agent-execution.ts';

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
