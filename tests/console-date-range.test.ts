import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from '@oddmash/agent-operator-contract';
import { filterActivity } from '../apps/console/src/activity.ts';
import { emptyDateRange, matchesDateRange, parseLocalDateTime, resolveDateRange } from '../apps/console/src/date-range.ts';

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
