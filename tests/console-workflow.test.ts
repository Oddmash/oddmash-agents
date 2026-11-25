import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from '@oddmash/agent-operator-contract';
import { targetObservations, roleObservations, publicationObservations, publicationPhaseObserved, publicationLink, stateCounts, specialistRoles, executionGroups, publicationCounts } from '../apps/console/src/workflow-model.ts';

const target = { repository: 'Oddmash/example', number: 12 };
const job: Job = { role: 'reviewer', correlationId: 'a'.repeat(24), attempt: 1, state: 'returned', updatedAt: '2026-01-01T00:00:00Z', target };

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
