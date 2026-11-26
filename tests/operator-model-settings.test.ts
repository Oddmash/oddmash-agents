import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { reviewWebhook } from '../apps/worker/src/webhook-review.ts';
import { advisoryConfig } from '../apps/worker/src/runtime-config.ts';
import { type Target } from '../apps/worker/src/webhook.ts';
import { approvedModelOverrides, effectiveOperatorModel, modelPolicy, parseModelOverrides, parseOperatorModelsRecord } from '../packages/operator-contract/src/model-settings.ts';
import { operatorStoreConfig, readOperatorModels, saveOperatorModels } from '../packages/operator-store/src/index.ts';
import { readReviewModelOverrides, advisoryModelConfig } from '../apps/worker/src/runtime-config.ts';
import { handleModelWrite } from '../apps/console/model-request.ts';

const revision = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const updatedAt = '2026-01-01T00:00:00.000Z';
const config = operatorStoreConfig('https://fixture.upstash.io', 'fixture-token')!;
const env = { OPENAI_MODEL: 'gpt-default', QA_OPENAI_MODEL: 'gpt-qa-default', QA_OPERATOR_ALLOWED_MODELS: 'gpt-approved, gpt-approved, invalid-name', REVIEWER_OPERATOR_ALLOWED_MODELS: 'gpt-lead-approved' };

test('model overrides are per-role and deployment policy is bounded', () => {
  const policy = modelPolicy(env);
  assert.equal(policy.reviewer.defaultModel, 'gpt-default');
  assert.equal(policy.qa.defaultModel, 'gpt-qa-default');
  assert.deepEqual(policy.qa.allowed, ['gpt-approved']);
  assert.equal(approvedModelOverrides({ qa: 'gpt-approved' }, policy), true);
  assert.equal(approvedModelOverrides({ docs: 'gpt-approved' }, policy), false);
  assert.equal(approvedModelOverrides({ reviewer: 'gpt-approved' }, policy), false);
  assert.deepEqual(parseModelOverrides({ qa: 'gpt-approved' }), { qa: 'gpt-approved' });
  assert.equal(parseModelOverrides({ qa: 'invalid-name' }), undefined);
  assert.equal(parseModelOverrides({ autoMerge: true }), undefined);
  assert.equal(parseOperatorModelsRecord({ revision, updatedAt, overrides: { qa: 'gpt-approved' }, autoMerge: true }), undefined);
  assert.equal(effectiveOperatorModel('qa', 'gpt-qa-default', { qa: 'gpt-approved' }, policy), 'gpt-approved');
  assert.equal(effectiveOperatorModel('qa', 'gpt-qa-default', { qa: 'gpt-approved' }, modelPolicy({})), 'gpt-qa-default');
  assert.equal(effectiveOperatorModel('docs', 'gpt-default', { qa: 'gpt-approved' }, policy), 'gpt-default');
});

test('read and save are independent from runtime budget and participation records', async () => {
  assert.deepEqual(await readOperatorModels(config, async () => Response.json([{ result: null }])), { revision: null, overrides: {}, updatedAt: null });
  let persisted: string | undefined;
  const record = await saveOperatorModels(config, null, { qa: 'gpt-approved' }, '123', async (_url, init) => {
    const command = JSON.parse(String(init?.body))[0];
    assert.equal(command[0], 'EVAL');
    assert.equal(command[3], 'oddmash:operator:models:v1');
    assert.equal(command[4], 'oddmash:operator:models-audit:v1');
    assert.equal(command[5], '');
    persisted = command[6];
    assert.deepEqual(JSON.parse(command[7]).overrides, { qa: 'gpt-approved' });
    assert.equal(JSON.parse(command[7]).ownerId, '123');
    assert.doesNotMatch(String(init?.body), /fixture-token/);
    return Response.json([{ result: 1 }]);
  });
  assert.deepEqual(await readOperatorModels(config, async () => Response.json([{ result: persisted }])), record);
  assert.equal(await saveOperatorModels(config, null, {}, '123', async () => Response.json([{ result: 0 }])), null);
});

test('owner write handler enforces policy prior to persist and returns revision conflict', async () => {
  const policy = modelPolicy(env);
  const request = (value: unknown) => new Request('https://console.example.test/api/models', { method: 'POST', body: JSON.stringify(value) });
  const valid = { revision, overrides: { qa: 'gpt-approved' } };
  const response = await handleModelWrite(request(valid), policy, async (expected, overrides) => {
    assert.equal(expected, revision);
    assert.deepEqual(overrides, valid.overrides);
    return { revision, updatedAt, overrides };
  });
  assert.equal(response.status, 200);
  assert.equal((await handleModelWrite(request(valid), policy, async () => null)).status, 409);
  for (const input of [{ ...valid, overrides: { reviewer: 'gpt-approved' } }, { ...valid, approval: true }, { ...valid, overrides: { qa: 'gpt-revoked' } }]) {
    assert.equal((await handleModelWrite(request(input), policy, async () => assert.fail('must not persist'))).status, 400);
  }
});

test('future jobs read approved settings once and fall back to deployment defaults when unavailable', async () => {
  const store = { ...env, OPERATOR_STORE_URL: 'https://fixture.upstash.io', OPERATOR_STORE_READ_TOKEN: 'fixture-token' };
  let reads = 0;
  const overrides = await readReviewModelOverrides(store, async (_url, init) => {
    reads++;
    assert.deepEqual(JSON.parse(String(init?.body)), [['GET', 'oddmash:operator:models:v1']]);
    return Response.json([{ result: JSON.stringify({ revision, updatedAt, overrides: { qa: 'gpt-approved' } }) }]);
  });
  assert.equal(reads, 1);
  assert.deepEqual(overrides, { qa: 'gpt-approved' });
  assert.deepEqual(await readReviewModelOverrides({}, async () => assert.fail('no approved models should not read')), {});
  assert.deepEqual(await readReviewModelOverrides(store, async () => { throw new Error('unavailable'); }), {});
  const keys = ['QA_OPERATOR_ALLOWED_MODELS', 'QA_OPENAI_MODEL', 'QA_OPENAI_API_KEY'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.QA_OPERATOR_ALLOWED_MODELS = 'gpt-approved';
    process.env.QA_OPENAI_MODEL = 'gpt-qa-default';
    process.env.QA_OPENAI_API_KEY = 'fixture-role-key';
    assert.deepEqual(advisoryModelConfig('qa', { model: 'gpt-default', openaiKey: 'fixture-shared-key' }, overrides), { model: 'gpt-approved', openaiKey: 'fixture-role-key' });
    delete process.env.QA_OPERATOR_ALLOWED_MODELS;
    assert.equal(advisoryModelConfig('qa', { model: 'gpt-default', openaiKey: 'fixture-shared-key' }, overrides).model, 'gpt-qa-default');
  } finally {
    for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  }
});

test('shared webhook and queue execution entry honors the dedicated and coordinated role choice', async t => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const settings = {
    OPERATOR_STORE_URL: 'https://fixture.upstash.io',
    OPERATOR_STORE_READ_TOKEN: 'fixture-token',
    OPENAI_API_KEY: 'fixture-shared',
    OPENAI_MODEL: 'gpt-default',
    TRIAGE_APP_ENABLED: 'true',
    TRIAGE_APP_ID: '43',
    TRIAGE_APP_PRIVATE_KEY: key,
    TRIAGE_WEBHOOK_SECRET: 'fixture-triage',
    TRIAGE_OPENAI_API_KEY: 'fixture-triage-key',
    TRIAGE_OPENAI_MODEL: 'gpt-role-default',
    TRIAGE_OPERATOR_ALLOWED_MODELS: 'gpt-approved-triage',
    REVIEWER_APP_ID: '42',
    REVIEWER_WEBHOOK_SECRET: 'fixture-lead'
  };
  const previous = Object.fromEntries(Object.keys(settings).map(name => [name, process.env[name]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  const repository = { id: 7, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' }, default_branch: 'main' };
  const root = '/repos/Oddmash/example';
  const requests: string[] = [];
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === 'https://fixture.upstash.io') {
      reads++;
      return Response.json([{ result: JSON.stringify({ revision, updatedAt, overrides: { triage: 'gpt-approved-triage' } }) }]);
    }
    if (url.origin === 'https://api.openai.com') {
      const body = JSON.parse(String(init?.body));
      requests.push(body.model);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-triage-key');
      assert.equal(body.store, false);
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ en: ['One', 'Two', 'Three', 'Four'], ko: ['하나', '둘', '셋', '넷'] }) }] }] });
    }
    assert.equal(url.origin, 'https://api.github.com');
    const path = url.pathname;
    if (path === root + '/installation') return Response.json({ id: 3, app_id: 43, app_slug: 'oddmash-triage', suspended_at: null });
    if (path === '/app/installations/3') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
    if (path === '/app/installations/3/access_tokens') return Response.json({ token: 'fixture-token' });
    if (path === root) return Response.json(repository);
    if (path === root + '/issues/1') return Response.json({ number: 1, title: 'Fixture', body: 'Fixture body', state: 'open' });
    if (path === root + '/branches/main') return Response.json({ name: 'main', commit: { sha: 'b'.repeat(40) } });
    if (path.includes('/contents/')) return new Response(null, { status: 404 });
    if (path === root + '/issues' || path === root + '/issues/1/comments') return Response.json([]);
    if (path === root + '/issues/comments/9') return Response.json({ id: 9, user: { id: 135234546, login: 'qtaghdi', type: 'User' }, body: '/triage', issue_url: 'https://api.github.com' + root + '/issues/1' });
    if (path.endsWith('/reactions')) return Response.json({ id: 1 });
    if (path.endsWith('/reactions/1')) return new Response(null, { status: 204 });
    assert.fail('Unexpected fixture request ' + path);
  });
  const target: Target = { repository: repository.full_name, repositoryId: repository.id, installation: 3, number: 1, advisory: 'triage', requestComment: { kind: 'issue', id: 9, slash: true } };
  const dedicated = advisoryConfig('triage');
  assert.ok(dedicated);
  await reviewWebhook({ ...target, advisoryIdentity: 'triage' }, dedicated);
  await reviewWebhook(target, { appId: '42', key, slug: 'oddmash-lead', openaiKey: 'fixture-shared', model: 'gpt-default' });
  assert.deepEqual(requests, ['gpt-approved-triage', 'gpt-approved-triage']);
  assert.equal(reads, 2);
});

test('model conflict recovery keeps local choices until explicit discard succeeds', async () => {
  const { reconcileModelDraft } = await import('../apps/console/src/model-settings-draft.ts');
  const latest = { revision, updatedAt, overrides: { qa: 'gpt-approved' }, policy: modelPolicy(env) };
  const draft = { reviewer: 'gpt-lead-approved' };
  assert.deepEqual(reconcileModelDraft(latest, draft, false), { saved: latest, draft, needsReview: true });
  assert.deepEqual(reconcileModelDraft(latest, draft, true), { saved: latest, draft: latest.overrides, needsReview: false });
});
