import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incrementalPaths, reviewBaseMarker, selectAdvisoryRoles } from '../src/review-follow-up-policy.ts';

const base = 'a'.repeat(40), oldHead = 'b'.repeat(40), head = 'c'.repeat(40);
const approved = { commit_id: oldHead, state: 'APPROVED', body: reviewBaseMarker(base) };
const comparison = { status: 'ahead', ahead_by: 1, total_commits: 1, files: [{ filename:'src/component.ts', status:'modified', changes: 3 }] };

test('only a verified compatible approved baseline permits bounded follow-up', () => {
  assert.deepEqual(incrementalPaths(approved, head, base, comparison), ['src/component.ts']);
  assert.deepEqual(incrementalPaths(approved, head, base, { ...comparison, files: [] }), []);
  assert.equal(incrementalPaths({ ...approved, state:'CHANGES_REQUESTED' }, head, base, comparison), undefined);
  assert.equal(incrementalPaths(approved, head, 'd'.repeat(40), comparison), undefined);
  assert.equal(incrementalPaths(approved, head, base, { ...comparison, status:'diverged' }), undefined);
  assert.equal(incrementalPaths(approved, head, base, { ...comparison, files: [{ filename:'src/component.ts', status:'removed', changes:3 }] }), undefined);
  assert.equal(incrementalPaths(approved, head, base, { ...comparison, files: [{ filename:'src/component.ts', status:'modified', changes:151 }] }), undefined);
  assert.equal(incrementalPaths(approved, head, base, { ...comparison, total_commits:2 }), undefined);
  assert.equal(incrementalPaths(approved, head, base, undefined), undefined);
});
test('advisory selection is deterministic, capped, and excludes issue triage', () => {
  assert.deepEqual(selectAdvisoryRoles([]), []);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'styles/theme.css' }]), []);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'README.md' }]), ['docs']);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'package.json' },{ filename:'src/api/client.ts' },{ filename:'src/domain/model.ts' }]), ['architect','release']);
  assert.ok(selectAdvisoryRoles([{ filename:'src/components/button.tsx' },{ filename:'docs/usage.md' },{ filename:'package.json' }]).length <= 2);
});

test('release advisory recognizes nested version and release files', () => {
  for (const filename of ['src/version.ts', 'packages/example/release.ts', 'package.json', 'CHANGELOG.md', '.changeset/example.md']) {
    assert.ok(selectAdvisoryRoles([{ filename }]).includes('release'), filename);
  }
});
