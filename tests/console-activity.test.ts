import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from '@oddmash/agent-operator-contract';
import { activitySummary, filterActivity, groupActivity, reviewOverview, activityDays, localDay, repositoryActivity, toggleRepositoryCollapse } from '../apps/console/src/activity.ts';

const jobs: Job[] = [
  { role: 'qa', correlationId: 'a'.repeat(24), attempt: 2, state: 'running', updatedAt: '2026-01-01T00:03:00Z' },
  { role: 'qa', correlationId: 'b'.repeat(24), attempt: 1, state: 'failed', updatedAt: '2026-01-01T00:01:00Z', failure: 'github' },
  { role: 'reviewer', correlationId: 'c'.repeat(24), attempt: 1, state: 'stale', updatedAt: '2026-01-01T00:00:00Z' },
  { role: 'impact', correlationId: 'd'.repeat(24), attempt: 1, state: 'returned', updatedAt: '2026-01-01T00:04:00Z' },
  { role: 'qa', correlationId: 'e'.repeat(24), attempt: 1, state: 'queued', updatedAt: '2026-01-01T00:02:00Z' }
];

test('observed role summary distinguishes active, stale, failed and returned', () => {
  const summary = activitySummary(jobs);
  assert.deepEqual(summary.counts, { queued: 1, running: 1, returned: 1, failed: 1, stale: 1, skipped: 0, published: 0 });
  assert.equal(summary.byRole.length, 7);
  assert.deepEqual(summary.byRole.find(row => row.role === 'qa'), { role: 'qa', active: 2, failed: 1, stale: 0, latest: jobs[0] });
  assert.equal(summary.byRole.find(row => row.role === 'reviewer')?.active, 0);
  assert.equal(summary.byRole.find(row => row.role === 'reviewer')?.stale, 1);
  assert.equal(summary.byRole.find(row => row.role === 'docs')?.latest, undefined);
  assert.equal(summary.byRole.find(row => row.role === 'impact')?.active, 0);
});

test('filters intersect role and state and preserve source order', () => {
  assert.deepEqual(filterActivity(jobs, { role: 'qa', state: 'all' }), [jobs[0], jobs[1], jobs[4]]);
  assert.deepEqual(filterActivity(jobs, { role: 'qa', state: 'failed' }), [jobs[1]]);
  assert.deepEqual(filterActivity(jobs, { role: 'all', state: 'stale' }), [jobs[2]]);
  assert.deepEqual(filterActivity(jobs, { role: 'docs', state: 'all' }), []);
  assert.deepEqual(filterActivity(jobs, { role: 'all', state: 'all' }), jobs);
});

test('empty telemetry does not invent an observation', () => {
  const summary = activitySummary([]);
  assert.deepEqual(summary.counts, { queued: 0, running: 0, returned: 0, failed: 0, stale: 0, skipped: 0, published: 0 });
  assert.equal(summary.byRole.length, 7);
  assert.ok(summary.byRole.every(row => row.latest === undefined && row.active === 0));
});

test('groups observed jobs by repository and target number, prioritizing active work', () => {
  const first = { ...jobs[0], target: { repository: 'Oddmash/ui', number: 12 } };
  const second = { ...jobs[3], target: { repository: 'Oddmash/UI', number: 12 } };
  const other = { ...jobs[1], target: { repository: 'Oddmash/agents', number: 12 } };
  const groups = groupActivity([second, other, jobs[2], first]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].jobs, [first, second]);
  assert.ok(groups.some(group => group.target === undefined && group.jobs[0] === jobs[2]));
  assert.ok(groups.some(group => group.target?.repository === 'Oddmash/agents'));
  assert.deepEqual(groupActivity([]), []);
});

test('review overview prioritizes identified targets and summarizes repeated roles', () => {
  const lead = { ...jobs[2], state: 'running' as const, target: { repository: 'Oddmash/ui', number: 3 } };
  const older = { ...lead, correlationId: 'f'.repeat(24), state: 'returned' as const, updatedAt: '2026-01-01T00:10:00Z' };
  const qa = { ...jobs[0], target: lead.target };
  const unknown = { ...jobs[4], updatedAt: '2026-01-01T00:11:00Z' };
  const grouped = groupActivity([unknown, older, qa, lead]);
  assert.ok(grouped[0].target);
  assert.equal(grouped.at(-1)?.target, undefined);
  assert.equal(grouped[0].jobs.length, 3);
  const overview = reviewOverview(grouped);
  assert.equal(overview.unattributedCount, 1);
  assert.equal(overview.identifiedCount, 1);
  assert.equal(overview.groups[0].total, 3);
  assert.deepEqual(overview.groups[0].jobs.map(job => job.role).sort(), ['qa', 'reviewer']);
  assert.equal(overview.groups[0].jobs.find(job => job.role === 'reviewer'), lead);
  assert.deepEqual(reviewOverview(groupActivity([unknown])).groups, []);
});

test('repository and local-day filters combine with role/state and keep unattributed work separate', () => {
  const first = { ...jobs[0], target: { repository: 'Oddmash/UI', number: 12 } };
  const second = { ...jobs[3], target: { repository: 'Oddmash/ui', number: 13 }, updatedAt: '2026-01-02T12:30:00Z' };
  const other = { ...jobs[1], target: { repository: 'Oddmash/agents', number: 12 } };
  const rows = [first, second, other, jobs[2]];
  const groups = repositoryActivity(rows);
  assert.equal(groups[0].key, 'oddmash/ui');
  assert.equal(groups[0].active, 1);
  assert.equal(groups[0].jobs.length, 2);
  assert.equal(groups.at(-1)?.key, 'unreported');
  assert.deepEqual(filterActivity(rows, { role: 'qa', state: 'running', repository: 'oddmash/ui', day: localDay(first.updatedAt) }), [first]);
  assert.deepEqual(filterActivity(rows, { role: 'all', state: 'all', repository: 'unreported' }), [jobs[2]]);
  assert.deepEqual(activityDays(rows), [...new Set(rows.map(row => localDay(row.updatedAt)))].sort().reverse());
  assert.equal(localDay('invalid'), '');
});

test('collapse state is independent of filtered and refreshed repository observations', () => {
  const initial = new Set<string>();
  const collapsed = toggleRepositoryCollapse(initial, 'oddmash/ui');
  assert.equal(initial.size, 0);
  assert.equal(collapsed.has('oddmash/ui'), true);
  const filtered = repositoryActivity(filterActivity(jobs, { role: 'all', state: 'all', repository: 'unreported' }));
  assert.equal(filtered.some(row => row.key === 'oddmash/ui'), false);
  assert.equal(collapsed.has('oddmash/ui'), true);
  assert.equal(toggleRepositoryCollapse(collapsed, 'oddmash/ui').has('oddmash/ui'), false);
});


test('counts and filters only observed skipped and publication-only states', () => {
  const observed = [
    { ...jobs[0], state: 'skipped' as const, skipReason: 'excluded' as const },
    { ...jobs[1], state: 'published' as const }
  ];
  const { counts, byRole } = activitySummary(observed);
  assert.equal(counts.skipped, 1);
  assert.equal(counts.published, 1);
  assert.equal(counts.returned, 0);
  assert.equal(byRole.find(role => role.role === 'qa')?.active, 0);
  assert.equal(filterActivity(observed, { role: 'all', state: 'skipped' }).length, 1);
});
