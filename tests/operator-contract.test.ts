import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnfinishedJob, jobElapsedMs, modelName, parseExecutionEvent, parseModelUsage, projectModelUsage, projectJobs, publicTarget } from '@oddmash/agent-operator-contract';

const event = { event: 'oddmash_agent_execution', role: 'reviewer', correlationId: 'a'.repeat(24), attempt: 1, timestamp: '2026-11-25T05:00:00.000Z', outcome: 'queued' };

test('projects actual lifecycle without treating returned as approved', () => {
  const start = { ...event, outcome: 'started', timestamp: '2026-11-25T05:00:01.000Z' };
  const phase = { ...start, outcome: 'phase', phase: 'reviewing', timestamp: '2026-11-25T05:00:02.000Z' };
  const returned = { ...phase, outcome: 'returned', timestamp: '2026-11-25T05:00:04.000Z' };
  assert.equal(projectJobs([returned, event, phase, start], Date.parse(returned.timestamp))[0].state, 'returned');
  assert.equal(projectJobs([event, phase], Date.parse(phase.timestamp))[0].phase, 'reviewing');
  assert.equal(projectJobs([event], Date.parse(event.timestamp) + 361000)[0].state, 'stale');
});

test('updates attempts and ignores delayed earlier events', () => {
  const failed = { ...event, outcome: 'failed', failure: 'github' };
  const retry = { ...event, attempt: 2, outcome: 'started' };
  const job = projectJobs([retry, failed], Date.parse(event.timestamp))[0];
  assert.equal(job.attempt, 2);
  assert.equal(job.state, 'running');
  assert.equal(job.failure, undefined);
});

test('projects only allowlisted fields and never private scope', () => {
  assert.equal(publicTarget({ repository: 'Oddmash/example', number: 1, private: true }), undefined);
  assert.equal(publicTarget({ repository: 'another/example', number: 1 }), undefined);
  assert.deepEqual(publicTarget({ repository: 'Oddmash/example', number: 1, private: false }), { repository: 'Oddmash/example', number: 1 });
  const parsed = parseExecutionEvent({ ...event, credential: 'fixture-value', target: { repository: 'Oddmash/example', number: 1, private: true } });
  assert.ok(parsed);
  assert.equal(parsed.target, undefined);
  assert.doesNotMatch(JSON.stringify(parsed), /fixture-value/);
  assert.equal(modelName('fixture-value'), null);
  assert.equal(modelName('gpt-5.4'), 'gpt-5.4');
});

test('unfinished job summary includes stale work but not terminal outcomes', () => {
  for (const state of ['queued', 'running', 'stale'] as const) assert.equal(isUnfinishedJob({ state }), true);
  for (const state of ['returned', 'failed'] as const) assert.equal(isUnfinishedJob({ state }), false);
  const stale = projectJobs([event], Date.parse(event.timestamp) + 361000)[0];
  assert.equal(isUnfinishedJob(stale), true);
});

test('elapsed timing includes queued age, stale age and recorded terminal duration', () => {
  const now = Date.parse(event.timestamp) + 361000;
  const queued = projectJobs([event], Date.parse(event.timestamp))[0];
  assert.equal(jobElapsedMs(queued, new Date(now).toISOString()), 361000);
  const stale = projectJobs([event], now)[0];
  assert.equal(jobElapsedMs(stale, new Date(now).toISOString()), 361000);
  assert.equal(jobElapsedMs({ ...queued, state: 'returned', durationMs: 42 }, new Date(now).toISOString()), 42);
  assert.equal(jobElapsedMs({ ...queued, state: 'failed' }, new Date(now).toISOString()), undefined);
});

test('retained model usage includes distinct terminal attempts and ignores unknown fields', () => {
  const usage = { calls: 1, inputTokens: 20, outputTokens: 5, missingInput: 0, missingOutput: 0, secret: 'fixture-secret' };
  const terminal = { ...event, outcome: 'returned', usage };
  assert.deepEqual(parseModelUsage(usage), { calls: 1, inputTokens: 20, outputTokens: 5, missingInput: 0, missingOutput: 0 });
  assert.equal(parseModelUsage({ ...usage, missingInput: 2 }), undefined);
  assert.equal(parseExecutionEvent({ ...event, usage })?.usage, undefined);
  assert.deepEqual(projectModelUsage([terminal, terminal, { ...terminal, attempt: 2 }, { ...terminal, role: 'qa', usage: { ...usage, outputTokens: 0, missingOutput: 1 } }]), [
    { role: 'reviewer', calls: 2, inputTokens: 40, outputTokens: 10, missingInput: 0, missingOutput: 0 },
    { role: 'qa', calls: 1, inputTokens: 20, outputTokens: 0, missingInput: 0, missingOutput: 1 }
  ]);
});

test('retains observed attempt timing, bounded phase transitions and measured terminal usage', () => {
  const start = { ...event, outcome: 'started', timestamp: '2026-11-25T05:00:01.000Z' };
  const phase = { ...start, outcome: 'phase', phase: 'collecting-context', timestamp: '2026-11-25T05:00:02.000Z' };
  const next = { ...phase, phase: 'reviewing', timestamp: '2026-11-25T05:00:03.000Z' };
  const end = { ...next, outcome: 'returned', timestamp: '2026-11-25T05:00:04.000Z', usage: { calls: 1, inputTokens: 10, outputTokens: 2, missingInput: 0, missingOutput: 0, untrusted: 'fixture' } };
  const [job] = projectJobs([end, next, phase, phase, start, event], Date.parse(end.timestamp));
  assert.equal(job.queuedAt, event.timestamp);
  assert.equal(job.startedAt, start.timestamp);
  assert.equal(job.finishedAt, end.timestamp);
  assert.deepEqual(job.phaseHistory, [{ phase: 'collecting-context', timestamp: phase.timestamp }, { phase: 'reviewing', timestamp: next.timestamp }]);
  assert.deepEqual(job.usage, { calls: 1, inputTokens: 10, outputTokens: 2, missingInput: 0, missingOutput: 0 });
  assert.equal(jobElapsedMs(job, end.timestamp), 3000);
  const [retry] = projectJobs([event, start, end, { ...event, attempt: 2, outcome: 'started' }], Date.parse(end.timestamp));
  assert.equal(retry.attempt, 2);
  assert.equal(retry.queuedAt, undefined);
  assert.equal(retry.finishedAt, undefined);
  assert.equal(retry.phaseHistory, undefined);
  assert.equal(retry.usage, undefined);
});
