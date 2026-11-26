import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultControls, deploymentControlLimits, parseOperatorControls, restrictAdvisoryBudget, withinDeploymentControlLimits } from '../packages/operator-contract/src/controls.ts';
import { operatorStoreConfig, readOperatorControls, saveOperatorControls } from '../packages/operator-store/src/index.ts';

const config = operatorStoreConfig('https://fixture.upstash.io', 'fixture-token')!;
test('operator restrictions cannot increase deployment or review budgets', () => {
  const base = { maxRequests: 3, elapsedMs: 45000 };
  assert.deepEqual(restrictAdvisoryBudget(base, defaultControls()), base);
  assert.deepEqual(restrictAdvisoryBudget(base, { ...defaultControls(), maxRequests: 5, maxMs: 120000 }), base);
  assert.deepEqual(restrictAdvisoryBudget(base, { ...defaultControls(), maxRequests: 2, maxMs: 15000 }), { maxRequests: 2, elapsedMs: 15000 });
  assert.deepEqual(restrictAdvisoryBudget(base, { ...defaultControls(), paused: true }), { maxRequests: 0, elapsedMs: 0 });
});
test('deployment caps are bounded, shared, and cannot be expanded by stored restrictions', () => {
  assert.deepEqual(deploymentControlLimits({}), { maxRequests: 5, maxMs: 90_000 });
  const limits = deploymentControlLimits({ REVIEWER_AUTO_ADVISORY_MAX_REQUESTS: '2', REVIEWER_AUTO_ADVISORY_MAX_MS: '10000' });
  assert.deepEqual(limits, { maxRequests: 2, maxMs: 10000 });
  assert.deepEqual(deploymentControlLimits({ REVIEWER_AUTO_ADVISORY_MAX_REQUESTS: '99', REVIEWER_AUTO_ADVISORY_MAX_MS: '999999' }), { maxRequests: 5, maxMs: 120000 });
  assert.deepEqual(deploymentControlLimits({ REVIEWER_AUTO_ADVISORY_MAX_REQUESTS: 'invalid', REVIEWER_AUTO_ADVISORY_MAX_MS: '-2' }), { maxRequests: 5, maxMs: 90000 });
  assert(withinDeploymentControlLimits(defaultControls(), limits));
  assert(withinDeploymentControlLimits({ ...defaultControls(), maxRequests: 0, maxMs: 0 }, limits));
  assert(!withinDeploymentControlLimits({ ...defaultControls(), maxRequests: 3 }, limits));
  assert(!withinDeploymentControlLimits({ ...defaultControls(), maxMs: 10001 }, limits));
});

test('operator controls reject unsupported role and authority fields', () => {
  const value = defaultControls();
  assert.equal(parseOperatorControls({ ...value, autoMerge: true }), undefined);
  assert.equal(parseOperatorControls({ ...value, excludedRoles: ['unknown'] }), undefined);
  assert.equal(parseOperatorControls({ ...value, excludedRoles: ['qa', 'qa'] }), undefined);
  assert.equal(parseOperatorControls({ ...value, maxRequests: 6 }), undefined);
  assert.equal(parseOperatorControls({ ...value, maxMs: -1 }), undefined);
  assert.deepEqual(parseOperatorControls({ ...value, excludedRoles: ['qa', 'impact'] })?.excludedRoles, ['impact', 'qa']);
});
test('controls store returns default or validated records and writes atomic revision/audit commands', async () => {
  assert.deepEqual(await readOperatorControls(config, async () => Response.json([{ result: null }])), { revision: null, controls: defaultControls(), updatedAt: null });
  const legacy = { revision: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', updatedAt: '2026-01-01T00:00:00Z', controls: { ...defaultControls(), excludedRoles: ['qa'] } };
  assert.deepEqual(await readOperatorControls(config, async () => Response.json([{ result: JSON.stringify(legacy) }])), legacy);
  let persisted: string | undefined;
  const record = await saveOperatorControls(config, null, { ...defaultControls(), paused: true, excludedRoles: ['qa', 'reviewer'] }, '123', async (_url, init) => {
    const command = JSON.parse(String(init?.body))[0];
    assert.equal(command[0], 'EVAL');
    assert.equal(command[2], 2);
    assert.equal(command[5], '');
    persisted = command[6];
    assert.deepEqual(JSON.parse(command[6]).controls.excludedRoles, ['qa']);
    assert.deepEqual(JSON.parse(command[6]).pausedPrimaryRoles, ['reviewer']);
    assert.equal(JSON.parse(command[7]).ownerId, '123');
    assert.doesNotMatch(String(init?.body), /fixture-token/);
    return Response.json([{ result: 1 }]);
  });
  assert.equal(record?.controls.paused, true);
  assert.deepEqual(record?.controls.excludedRoles, ['qa', 'reviewer']);
  assert.deepEqual(await readOperatorControls(config, async () => Response.json([{ result: persisted }])), record);
  assert.equal(await saveOperatorControls(config, null, defaultControls(), '123', async () => Response.json([{ result: 0 }])), null);
  await assert.rejects(readOperatorControls(config, async () => Response.json([{ result: 'invalid' }])));
});

test('canonical control write handler preserves the revision and signals conflict', async () => {
  const { handleControlWrite } = await import('../apps/console/control-request.ts');
  const controls = { ...defaultControls(), maxRequests: 2 };
  const request = () => new Request('https://console.example.test/api/controls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ controls, revision: null }) });
  const response = await handleControlWrite(request(), async (revision, value) => {
    assert.equal(revision, null);
    assert.deepEqual(value, controls);
    return { revision: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', controls: value, updatedAt: '2026-01-01T00:00:00Z' };
  });
  assert.equal(response.status, 200);
  assert.deepEqual('limits' in response.body ? response.body.limits : null, { maxRequests: 5, maxMs: 90000 });
  assert.equal(await handleControlWrite(request(), async () => { throw new Error('must not write'); }, { maxRequests: 1, maxMs: 10000 }).then(value => value.status), 422);
  assert.equal(await handleControlWrite(request(), async () => null).then(value => value.status), 409);
  const invalid = new Request('https://console.example.test/api/controls', { method: 'POST', body: JSON.stringify({ controls: { ...controls, autoMerge: true }, revision: null }) });
  assert.equal((await handleControlWrite(invalid, async () => { throw new Error('must not write'); })).status, 400);
});

test('conflict review retains local edits and requires explicit review of latest saved settings', async () => {
  const { reviewRetainedDraft } = await import('../apps/console/src/control-draft.ts');
  const draft = { ...defaultControls(), paused: true, maxRequests: 2 };
  const latest = { revision: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', controls: { ...defaultControls(), maxRequests: 4 }, updatedAt: '2026-01-01T00:00:00Z' };
  const result = reviewRetainedDraft(latest, draft);
  assert.equal(result.needsReview, true);
  assert.equal(result.saved, latest);
  assert.equal(result.draft, draft);
  assert.equal(result.draft.maxRequests, 2);
  assert.equal(result.saved.controls.maxRequests, 4);
});
