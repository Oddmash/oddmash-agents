import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from '@oddmash/agent-operator-contract';
import { targetObservations, roleObservations, publicationObservations, publicationPhaseObserved, publicationLink, stateCounts, specialistRoles, executionGroups, publicationCounts } from '../apps/console/src/workflow-model.ts';
import { latestObservation, workflowRoleGroups } from '../apps/console/src/workflow-model.ts';
import { publicationStageObservations, observedStages } from '../apps/console/src/workflow-model.ts';

const target = { repository: 'Oddmash/example', number: 12 };
const job: Job = { role: 'reviewer', correlationId: 'a'.repeat(24), attempt: 1, state: 'returned', updatedAt: '2026-01-01T00:00:00Z', target };

test('stage timelines retain only recorded phases and distinguish failure from elapsed intervals', () => {
  const first = { phase: 'publishing' as const, timestamp: '2026-01-01T00:00:00Z' };
  const second = { phase: 'publishing' as const, timestamp: '2026-01-01T00:00:02Z' };
  const failed: Job = { ...job, state: 'failed', phase: 'publishing', phaseHistory: [first, second], finishedAt: '2026-01-01T00:00:03Z' };
  assert.deepEqual(observedStages(failed), [{ ...first, intervalMs: 2000, state: 'observed' }, { ...second, intervalMs: 1000, state: 'failed' }]);
  assert.deepEqual(observedStages({ ...failed, phase: undefined }), [{ ...first, intervalMs: 2000, state: 'observed' }, { ...second, intervalMs: undefined, state: 'observed' }]);
  assert.deepEqual(observedStages({ ...failed, state: 'running', finishedAt: undefined }).at(-1), { ...second, intervalMs: undefined, state: 'running' });
  assert.deepEqual(observedStages({ ...failed, state: 'stale', finishedAt: undefined }).at(-1), { ...second, intervalMs: undefined, state: 'observed' });
  assert.equal(observedStages({ ...failed, finishedAt: first.timestamp }).at(-1)?.intervalMs, undefined);
  assert.deepEqual(observedStages({ ...failed, phaseHistory: undefined }), []);
});

test('target workflow isolates observations by repository and number, retaining independent roles and attempts', () => {
  const qa = { ...job, role: 'qa' as const, target: { repository: 'Oddmash/EXAMPLE', number: 12 } };
  const other = { ...job, target: { repository: 'Oddmash/example', number: 13 } };
  const rows = targetObservations(target, [job, qa, other, { ...job, target: undefined }]);
  assert.deepEqual(rows, [job, qa]);
  assert.deepEqual(roleObservations('qa', rows), [qa]);
  assert.deepEqual(roleObservations('triage', rows), []);
  assert.ok(!specialistRoles.some(role => String(role) === 'triage'));
});

test('returned and publishing phase do not establish publication, skipped or approval', () => {
  assert.deepEqual(stateCounts([job]), { returned: 1 });
  assert.deepEqual(stateCounts([]), {});
  assert.equal(publicationObservations([job]).length, 0);
  assert.equal(publicationPhaseObserved([job]), false);
  const publishing = { ...job, phase: 'publishing' as const };
  assert.equal(publicationPhaseObserved([publishing]), true);
  assert.equal(publicationObservations([publishing]).length, 0);
  assert.equal(publicationLink(target, publishing), undefined);
  const posted = { ...job, publication: { kind: 'review' as const, at: job.updatedAt, id: 123 } };
  assert.equal(publicationObservations([posted]).length, 1);
  assert.equal(publicationLink(target, posted), 'https://github.com/Oddmash/example/pull/12#pullrequestreview-123');
});

test('publication links distinguish issue comments and inline review comments', () => {
  assert.equal(publicationLink(target, { ...job, publication: { kind: 'inline-comment', at: job.updatedAt, id: 2 } }), 'https://github.com/Oddmash/example/pull/12#discussion_r2');
  assert.equal(publicationLink(target, { ...job, publication: { kind: 'comment', at: job.updatedAt, id: 3 } }), 'https://github.com/Oddmash/example/issues/12#issuecomment-3');
  assert.equal(publicationLink(target, { ...job, publication: { kind: 'review', at: job.updatedAt, id: -1 } }), undefined);
});

test('distinct observed executions remain separate with their attempts, and links require matching target', () => {
  const secondAttempt = { ...job, attempt: 2 };
  const independent = { ...job, correlationId: 'b'.repeat(24) };
  const groups = executionGroups([job, independent, secondAttempt]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].records, [secondAttempt, job]);
  assert.deepEqual(groups[1].records, [independent]);
  assert.equal(publicationLink({ ...target, number: 13 }, { ...job, publication: { kind: 'review', at: job.updatedAt, id: 5 } }), undefined);
});

test('conversation comments do not count as published reviews', () => {
  const comment = { ...job, publication: { kind: 'comment' as const, at: job.updatedAt, id: 12 } };
  assert.deepEqual(publicationCounts([comment]), { review: 0, 'inline-comment': 0, comment: 1 });
});


test('explicit skip and publication-only observations are not completed reviews', () => {
  const skipped = { ...job, role: 'qa' as const, state: 'skipped' as const, skipReason: 'request-budget' as const };
  const posted = { ...job, state: 'published' as const, publication: { kind: 'review' as const, id: 4, at: job.updatedAt } };
  assert.deepEqual(stateCounts([skipped, posted]), { skipped: 1, published: 1 });
  assert.deepEqual(publicationObservations([skipped, posted]), [posted]);
  assert.deepEqual(roleObservations('qa', [skipped, posted]), [skipped]);
});

test('latest details come from one exact observation, including explicit skipped states and independently timed attempts', () => {
  const recent = { ...job, state: 'skipped' as const, phase: undefined, skipReason: 'time-budget' as const, updatedAt: '2026-01-02T00:00:00Z' };
  const oldAttempt = { ...job, state: 'failed' as const, attempt: 5 };
  assert.equal(latestObservation([oldAttempt, recent, job]), recent);
  assert.equal(latestObservation([job, oldAttempt]), oldAttempt);
  assert.equal(latestObservation([]), undefined);
});

test('publication stage retains phase-only attempts and selects the actual latest rather than a historical publication', () => {
  const publication = { ...job, publication: { kind: 'review' as const, at: job.updatedAt, id: 8 } };
  const later = { ...job, attempt: 2, state: 'running' as const, phase: 'publishing' as const, updatedAt: '2026-01-02T00:00:00Z' };
  const skipped = { ...job, role: 'release' as const, state: 'skipped' as const };
  const history = { ...job, role: 'qa' as const, phaseHistory: [{ phase: 'publishing' as const, timestamp: job.updatedAt }] };
  const both = { ...publication, role: 'docs' as const, phase: 'publishing' as const };
  const stage = publicationStageObservations([publication, later, skipped, history, both]);
  assert.deepEqual(stage, [publication, later, history, both]);
  assert.equal(latestObservation(stage), later);
  assert.equal(publicationObservations(stage).length, 2);
});


test('observed roles surface failed and active attempts first; missing roles stay distinct', () => {
  const failed = { ...job, role: 'docs' as const, state: 'failed' as const };
  const active = { ...job, role: 'qa' as const, state: 'running' as const };
  const result = workflowRoleGroups([job,active,failed]);
  assert.deepEqual(result.observed,['docs','qa','reviewer']);
  assert.deepEqual(result.unobserved,['triage','impact','architect','release']);
  assert.equal(workflowRoleGroups([]).observed.length,0);
});

test('roles in the same attention bucket sort by relevant newest observation', () => {
  const old = { ...job, role:'docs' as const, state:'failed' as const };
  const recent = { ...old, role:'qa' as const, updatedAt:'2026-01-02T00:00:00Z' };
  const unrelated = { ...old, state:'returned' as const, updatedAt:'2026-01-03T00:00:00Z' };
  assert.deepEqual(workflowRoleGroups([old,recent,unrelated]).observed,['qa','docs']);
});
