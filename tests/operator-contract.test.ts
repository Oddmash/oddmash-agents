import test from 'node:test';
import assert from 'node:assert/strict';
import { modelName, parseExecutionEvent, projectJobs, publicTarget } from '../packages/operator-contract/src/index.ts';

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
