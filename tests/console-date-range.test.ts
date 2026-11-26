import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from '@oddmash/agent-operator-contract';
import { filterActivity } from '../apps/console/src/activity.ts';
import { emptyDateRange, matchesDateRange, parseLocalDateTime, resolveDateRange, historyBounds, historyPreset, selectRangeDate, setRangeTime, validHistoryRange, organizationStart } from '../apps/console/src/date-range.ts';

test('calendar history bounds are local and presets include the full day without predating the organization', () => {
  const now = new Date(2026, 3, 27, 14);
  const { min, max } = historyBounds(now);
  const earliest = new Date(organizationStart);
  assert.equal(min, [earliest.getFullYear(), String(earliest.getMonth() + 1).padStart(2, '0'), String(earliest.getDate()).padStart(2, '0')].join('-'));
  assert.equal(max, '2026-04-27');
  assert.deepEqual(historyPreset(30, now), { from: min + 'T00:00:00', to: max + 'T23:59:59' });
  assert.deepEqual(historyPreset(1, now), { from: max + 'T00:00:00', to: max + 'T23:59:59' });
  assert.equal(validHistoryRange({ from: '2026-04-01T00:00:00', to: '' }, now), false);
  assert.equal(validHistoryRange({ from: '', to: '2026-04-28T00:00:00' }, now), false);
  assert.equal(validHistoryRange({ from: max + 'T23:59:59', to: min + 'T00:00:00' }, now), false);
});

test('calendar selection defaults to day boundaries, preserves explicit time, and clears each bound independently', () => {
  const start = selectRangeDate(emptyDateRange(), 'from', '2026-05-01');
  const both = selectRangeDate(start, 'to', '2026-05-02');
  assert.deepEqual(both, { from: '2026-05-01T00:00:00', to: '2026-05-02T23:59:59' });
  const exact = setRangeTime(both, 'from', '12:34:56');
  assert.equal(selectRangeDate(exact, 'from', '2026-05-02').from, '2026-05-02T12:34:56');
  assert.deepEqual(selectRangeDate(exact, 'from', ''), { from: '', to: both.to });
  assert.equal(setRangeTime(both, 'to', '08:30').to, '2026-05-02T08:30:00');
});

test('valid local timestamps preserve seconds and reject invalid calendar values', () => {
  const local = parseLocalDateTime('2024-02-29T12:34:56');
  assert.equal(local, new Date(2024, 1, 29, 12, 34, 56).getTime());
  assert.equal(parseLocalDateTime('2025-02-29T12:34:56'), undefined);
  assert.equal(parseLocalDateTime('2024-02-29T12:34:60'), undefined);
  assert.equal(parseLocalDateTime('2024-02-29T12:34:56Z'), undefined);
  assert.equal(parseLocalDateTime('0000-01-01T00:00:00'), undefined);
});

test('range is inclusive for the full selected end second and supports either open bound', () => {
  const value = '2026-01-02T12:34:56';
  const moment = parseLocalDateTime(value)!;
  const range = { from: value, to: value };
  assert.ok(matchesDateRange(new Date(moment).toISOString(), range));
  assert.ok(matchesDateRange(new Date(moment + 999).toISOString(), range));
  assert.equal(matchesDateRange(new Date(moment + 1000).toISOString(), range), false);
  assert.equal(matchesDateRange(new Date(moment - 1).toISOString(), range), false);
  assert.ok(matchesDateRange(new Date(moment - 1).toISOString(), { from: '', to: value }));
  assert.ok(matchesDateRange(new Date(moment + 1000).toISOString(), { from: value, to: '' }));
  assert.ok(matchesDateRange(new Date(moment).toISOString(), emptyDateRange()));
  assert.equal(resolveDateRange({ from: '2026-01-02T12:34:57', to: value }), undefined);
  assert.equal(resolveDateRange({ from: 'invalid', to: '' }), undefined);
});

test('precise range intersects existing repository, role and state filters', () => {
  const from = '2026-01-02T12:34:56';
  const time = parseLocalDateTime(from)!;
  const job: Job = { role: 'reviewer', correlationId: 'a'.repeat(24), attempt: 1, state: 'returned', updatedAt: new Date(time + 500).toISOString(), target: { repository: 'Oddmash/example', number: 1 } };
  const filter = { role: 'reviewer' as const, state: 'returned' as const, repository: 'oddmash/example', range: { from, to: from } };
  const other = { ...job, target: { repository: 'Oddmash/other', number: 1 } };
  const late = { ...job, updatedAt: new Date(time + 1000).toISOString() };
  assert.deepEqual(filterActivity([job, other, late], filter), [job]);
  assert.deepEqual(filterActivity([job], { ...filter, range: { from: 'invalid', to: '' } }), []);
});
