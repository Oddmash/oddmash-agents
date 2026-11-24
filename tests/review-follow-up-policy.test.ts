import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticAdvisoryBudget, automaticAdvisoryPaths, incrementalPaths, reviewBaseMarker, runCoordinatedAdvisories, selectAdvisoryRoles } from '../src/review-follow-up-policy.ts';

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
test('automatic routing chooses only relevant roles and skips trivial docs', () => {
  assert.deepEqual(selectAdvisoryRoles([]), []);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'README.md', status:'modified', changes:2 }]), []);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'README.md' }]), ['docs']);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'styles/theme.css' }]), ['qa']);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'src/components/button.tsx' }]), ['impact','qa']);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'src/api/client.ts' }]), ['impact','qa','docs']);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'src/architecture/module.ts' }]), ['architect','qa']);
  assert.deepEqual(selectAdvisoryRoles([{ filename:'package.json' }]), ['release']);
});

test('mixed changes select each justified role, respecting request budget and stable priority', () => {
  const files = [{ filename:'src/components/button.tsx' }, { filename:'docs/usage.md' }, { filename:'package.json' }, { filename:'src/domain/model.ts' }];
  const all = ['release','architect','impact','qa','docs'];
  assert.deepEqual(selectAdvisoryRoles(files), all);
  assert.deepEqual(selectAdvisoryRoles([...files].reverse()), all);
  assert.deepEqual(selectAdvisoryRoles([...files,...files], 3), all.slice(0,3));
  assert.deepEqual(selectAdvisoryRoles(files, 0), []);
  assert.deepEqual(selectAdvisoryRoles(files, 50), all);
});

test('automatic routing excludes sensitive and operational paths', () => {
  const filenames = ['src/auth.ts', 'src/security/check.ts', 'src/security-vulns.ts', '.github/workflows/ci.yml', '.env.local', 'src/deploy.ts', 'src/auto-merge.ts', 'credentials.pem', 'src/components/card.tsx'];
  const files = filenames.map(filename => ({ filename }));
  assert.deepEqual(automaticAdvisoryPaths(files), ['src/components/card.tsx']);
  assert.deepEqual(selectAdvisoryRoles(files.slice(0,-1)), []);
});

test('budgets are bounded, tunable, and leave time for the primary review', () => {
  assert.deepEqual(automaticAdvisoryBudget({}), { maxRequests:5, elapsedMs:90_000 });
  assert.deepEqual(automaticAdvisoryBudget({ REVIEWER_AUTO_ADVISORY_MAX_REQUESTS:'abc', REVIEWER_AUTO_ADVISORY_MAX_MS:'abc' }), { maxRequests:5, elapsedMs:90_000 });
  assert.deepEqual(automaticAdvisoryBudget({ REVIEWER_AUTO_ADVISORY_MAX_REQUESTS:'100', REVIEWER_AUTO_ADVISORY_MAX_MS:'500000' }), { maxRequests:5, elapsedMs:120_000 });
  assert.deepEqual(automaticAdvisoryBudget({ REVIEWER_AUTO_ADVISORY_MAX_REQUESTS:'2', REVIEWER_AUTO_ADVISORY_MAX_MS:'10000' }), { maxRequests:2, elapsedMs:10_000 });
  assert.deepEqual(automaticAdvisoryBudget({}, 240_000), { maxRequests:5, elapsedMs:5_000 });
  assert.deepEqual(automaticAdvisoryBudget({}, 245_000), { maxRequests:5, elapsedMs:0 });
  assert.deepEqual(automaticAdvisoryBudget({ REVIEWER_AUTO_ADVISORY_MAX_REQUESTS:'0', REVIEWER_AUTO_ADVISORY_MAX_MS:'0' }), { maxRequests:0, elapsedMs:0 });
});

test('coordinator counts failed attempts, avoids triage and duplicates, and stops when stale', async () => {
  const seen: string[] = [];
  await runCoordinatedAdvisories(['triage','qa','qa','docs','release'], { maxRequests:2, elapsedMs:10_000 }, async (role, signal) => {
    assert.equal(signal.aborted, false);
    seen.push(role);
    if (role === 'qa') throw new Error('Unavailable');
    return true;
  });
  assert.deepEqual(seen, ['qa','docs']);
  seen.length = 0;
  await runCoordinatedAdvisories(['impact','qa'], { maxRequests:5, elapsedMs:10_000 }, async role => { seen.push(role); return false; });
  assert.deepEqual(seen, ['impact']);
});

test('coordinator stops scheduling after elapsed or quota budget exhaustion', async () => {
  let now = 0;
  const seen: string[] = [];
  await runCoordinatedAdvisories(['qa','docs'], { maxRequests:5, elapsedMs:50 }, async role => { seen.push(role); now = 51; return true; }, () => now);
  assert.deepEqual(seen, ['qa']);
  seen.length = 0;
  await runCoordinatedAdvisories(['qa','docs'], { maxRequests:5, elapsedMs:10_000 }, async role => {
    seen.push(role);
    throw new Error('Model quota, rate or credit limit reached; stop and check API billing before retrying');
  });
  assert.deepEqual(seen, ['qa']);
});

test('release advisory recognizes nested version and release files', () => {
  for (const filename of ['src/version.ts', 'packages/example/release.ts', 'package.json', 'CHANGELOG.md', '.changeset/example.md']) {
    assert.ok(selectAdvisoryRoles([{ filename }]).includes('release'), filename);
  }
});


test('ordinary filenames containing sensitive token prefixes remain eligible', () => {
  const filenames = ['src/authors.ts', 'src/deploymentBanner.ts', 'src/auth/index.ts', 'infra/deploy.ts'];
  assert.deepEqual(automaticAdvisoryPaths(filenames.map(filename => ({ filename }))), filenames.slice(0, 2));
});

test('infrastructure changes select dedicated Docs and QA without exposing operational paths', () => {
  const files = [
    { filename: '.github/workflows/ci-scope.yml', changes: 12 },
    { filename: 'AGENTS.md', status: 'modified', changes: 3 },
    { filename: 'CONTRIBUTING.md', status: 'modified', changes: 3 },
    { filename: 'docs/AI-CODE-REVIEW.md', status: 'modified', changes: 8 },
    { filename: 'scripts/pr-format.test.mjs', changes: 40 }
  ];
  assert.deepEqual(automaticAdvisoryPaths(files), files.slice(1).map(file => file.filename));
  assert.deepEqual(selectAdvisoryRoles(files), ['qa', 'docs']);
  for (const filename of ['scripts/check.mjs', 'scripts/check.cjs', 'src/check.mts', 'src/check.cts']) assert.deepEqual(selectAdvisoryRoles([{ filename }]), ['qa']);
  assert.deepEqual(selectAdvisoryRoles([{ filename: 'AGENTS.md', status: 'modified', changes: 2 }]), []);
});
