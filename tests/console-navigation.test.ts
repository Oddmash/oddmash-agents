import assert from 'node:assert/strict';
import test from 'node:test';
import { historyNeedsRepository, metricFilter } from '../apps/console/src/activity.ts';
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
