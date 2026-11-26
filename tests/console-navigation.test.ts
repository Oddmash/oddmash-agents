import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from '@oddmash/agent-operator-contract';
import { filterActivity, historyNeedsRepository, metricFilter, repositoryActivity, withRepositoryFilter } from '../apps/console/src/activity.ts';
import { parseTheme, resolveTheme } from '../apps/console/src/console-preferences.ts';
import { executionLabel, executionTone } from '../apps/console/src/execution-status.ts';

test('metric filters reset unrelated constraints and lead to repository selection', () => {
  const filter = metricFilter('failed');
  assert.deepEqual(filter, { role: 'all', state: 'failed' });
  assert.equal(historyNeedsRepository('activity', filter), true);
  assert.equal(historyNeedsRepository('activity', { ...filter, repository: 'all' }), true);
  assert.equal(historyNeedsRepository('activity', { ...filter, repository: 'oddmash/ui' }), false);
  assert.equal(historyNeedsRepository('activity', { ...filter, repository: 'unreported' }), false);
  assert.equal(historyNeedsRepository('overview', filter), false);
});

test('changing history repositories returns to the filtered chooser without losing other constraints', () => {
  const first: Job = { role: 'reviewer', correlationId: 'a'.repeat(24), attempt: 1, state: 'failed', updatedAt: '2026-05-10T12:00:00Z', target: { repository: 'Oddmash/ui', number: 4 } };
  const second: Job = { ...first, correlationId: 'b'.repeat(24), target: { repository: 'Oddmash/agents', number: 5 } };
  const unknown: Job = { ...first, correlationId: 'c'.repeat(24), target: undefined };
  const success: Job = { ...first, correlationId: 'd'.repeat(24), state: 'returned' };
  const jobs = [first, second, unknown, success];
  const range = { from: '2026-05-09T00:00:00', to: '2026-05-12T00:00:00' };
  const filtered = { ...metricFilter('failed'), role: 'reviewer' as const, range };
  const selected = withRepositoryFilter(filtered, 'oddmash/ui');
  assert.deepEqual(filterActivity(jobs, selected), [first]);
  assert.equal(historyNeedsRepository('activity', selected), false);
  const chooser = withRepositoryFilter(selected);
  assert.deepEqual(chooser, { ...filtered, repository: undefined });
  assert.equal(historyNeedsRepository('activity', chooser), true);
  assert.deepEqual(repositoryActivity(filterActivity(jobs, chooser)).map(row => row.key).sort(), ['oddmash/agents', 'oddmash/ui', 'unreported']);
  assert.deepEqual(filterActivity(jobs, withRepositoryFilter(chooser, 'unreported')), [unknown]);
  assert.deepEqual(withRepositoryFilter(selected, 'all'), chooser);
  assert.equal(historyNeedsRepository('overview', chooser), false);
});

test('theme preference distinguishes explicit and live system selection', () => {
  assert.equal(parseTheme('dark'), 'dark');
  assert.equal(parseTheme('unknown'), 'system');
  assert.equal(parseTheme(null), 'system');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
});

test('execution labels and tones describe only observed state', () => {
  assert.equal(executionLabel('ko', 'returned', 'reviewer'), '리뷰 처리 완료');
  assert.equal(executionLabel('ko', 'returned', 'triage'), '이슈 분류 완료');
  assert.equal(executionLabel('en', 'failed'), 'Processing failed');
  assert.equal(executionTone('returned'), 'success');
  assert.equal(executionTone('failed'), 'danger');
  assert.equal(executionTone('running'), 'active');
  assert.equal(executionTone('stale'), 'warning');
  assert.equal(executionLabel('ko', 'skipped'), '검토 건너뜀');
  assert.equal(executionLabel('en', 'published'), 'Publication confirmed');
  assert.equal(executionTone('skipped'), 'neutral');
  assert.equal(executionTone('published'), 'success');
  assert.equal(executionTone('queued'), 'info');
});
