import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { authorizeCoordinatedAdvisor } from '../src/coordinated-advisory.ts';

const repo = { id: 7, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
const target = { installation: 3, repository: repo.full_name, repositoryId: repo.id, number: 1, expectedHead: 'a'.repeat(40) };

test('automatic QA uses its own app, installation and repository-scoped token', async t => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const settings = { QA_APP_ENABLED: 'true', QA_APP_ID: '1234', QA_APP_PRIVATE_KEY: key, QA_WEBHOOK_SECRET: 'qa-fixture', QA_OPENAI_API_KEY: 'model-fixture', QA_OPENAI_MODEL: 'fixture', REVIEWER_APP_ID: '42', REVIEWER_WEBHOOK_SECRET: 'reviewer-fixture' };
  const prior = Object.fromEntries(Object.keys(settings).map(name => [name, process.env[name]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [name, value] of Object.entries(prior)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  const calls: string[] = [];
  let wrongApp = false;
  let wrongRepo = false;
  const request: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    const token = new Headers(init?.headers).get('authorization')!;
    if (path === '/repos/Oddmash/example/installation') {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      assert.equal(payload.iss, '1234');
      return Response.json({ id: 9, app_id: wrongApp ? 42 : 1234, suspended_at: null });
    }
    if (path === '/app/installations/9') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
    if (path === '/app/installations/9/access_tokens') {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.repository_ids, [7]);
      assert.equal(body.permissions.contents, 'read');
      assert.equal(body.permissions.issues, 'write');
      assert.equal(body.permissions.checks, 'read');
      return Response.json({ token: 'qa-installation-fixture' });
    }
    if (path === '/repos/Oddmash/example') {
      assert.equal(token, 'Bearer qa-installation-fixture');
      return Response.json({ ...repo, id: wrongRepo ? 8 : 7 });
    }
    if (path === '/repos/Oddmash/example/issues/1/comments') {
      assert.equal(token, 'Bearer qa-installation-fixture');
      return Response.json({ user: { login: 'oddmash-qa[bot]' } });
    }
    assert.fail(path);
  };
  const role = await authorizeCoordinatedAdvisor(target, 'qa', '42', request);
  assert.equal(role?.target.installation, 9);
  assert.equal(role?.target.advisoryIdentity, 'qa');
  assert.equal(role?.config.bot, 'oddmash-qa[bot]');
  assert.equal(role?.config.model, 'fixture');
  assert.ok(role);
  await role.api('/repos/Oddmash/example/issues/1/comments', { method: 'POST', body: '{}' });
  assert.ok(!calls.includes('/app/installations/3'));
  wrongApp = true;
  await assert.rejects(authorizeCoordinatedAdvisor(target, 'qa', '42', request), /Installation not eligible/);
  wrongApp = false;
  wrongRepo = true;
  await assert.rejects(authorizeCoordinatedAdvisor(target, 'qa', '42', request), /Repository not eligible/);
  wrongRepo = false;
  const before = calls.length;
  assert.equal(await authorizeCoordinatedAdvisor(target, 'triage', '42', request), undefined);
  assert.equal(await authorizeCoordinatedAdvisor(target, 'qa', '1234', request), undefined);
  process.env.QA_APP_ENABLED = 'false';
  assert.equal(await authorizeCoordinatedAdvisor(target, 'qa', '42', request), undefined);
  assert.equal(calls.length, before);
});
