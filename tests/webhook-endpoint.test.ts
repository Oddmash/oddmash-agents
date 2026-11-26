import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { POST } from '../api/github.ts';
import { POST as advisoryPost } from '../api/advisory.ts';

test('signed review requests distinguish rejected syntax from unavailable processing', async () => {
  const secret = 'synthetic-webhook-secret';
  const slug = 'oddmash-reviewer';
  const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
  process.env.REVIEWER_WEBHOOK_SECRET = secret;
  process.env.REVIEWER_APP_SLUG = slug;
  process.env.REVIEWER_APP_ENABLED = 'false';
  const request = (body: string, signatureSecret = secret, sender = actor) => {
    const payload = JSON.stringify({
      action: 'created', installation: { id: 3 },
      repository: { id: 7, full_name: 'Oddmash/fixture', private: false, visibility: 'public', owner: { login: 'Oddmash' } },
      sender, issue: { number: 2, pull_request: {} }, comment: { id: 5, user: sender, body }
    });
    return new Request('https://example.invalid/api/github', {
      method: 'POST', body: payload,
      headers: { 'x-github-event': 'issue_comment', 'x-hub-signature-256': `sha256=${createHmac('sha256', signatureSecret).update(payload).digest('hex')}` }
    });
  };
  const context = 'synthetic verification context';
  const invalid = await POST(request(`@${slug} /review please ${context}`));
  assert.equal(invalid.status, 200);
  assert.equal(await invalid.text(), 'Ignored: Review command not recognized; put an explicit review command on the first line or reference the original finding for scoped verification');
  const valid = await POST(request(`@${slug} /review\n\n${context}`));
  assert.equal(valid.status, 503);
  assert.equal(await valid.text(), 'Unavailable');
  const unsigned = await POST(request(`@${slug} /review\n${context}`, 'incorrect-fixture-secret'));
  assert.equal(unsigned.status, 401);
  const unauthorized = await POST(request(`@${slug} /review please ${context}`, secret, { ...actor, id: 10 }));
  assert.equal(unauthorized.status, 200);
  assert.equal(await unauthorized.text(), 'Ignored');
});

test('direct Lead and Triage deliveries return 503 before model lookup if controls are unavailable', async t => {
  const settings = {
    REVIEWER_APP_ENABLED: 'true', REVIEWER_APP_ID: '42', REVIEWER_APP_PRIVATE_KEY: 'fixture',
    REVIEWER_APP_SLUG: 'oddmash-reviewer', REVIEWER_WEBHOOK_SECRET: 'lead-fixture',
    TRIAGE_APP_ENABLED: 'true', TRIAGE_APP_ID: '43', TRIAGE_APP_PRIVATE_KEY: 'fixture',
    TRIAGE_WEBHOOK_SECRET: 'triage-fixture', OPENAI_API_KEY: 'fixture',
    OPERATOR_STORE_URL: 'https://fixture.upstash.io', OPERATOR_STORE_READ_TOKEN: 'fixture',
    REVIEWER_QUEUE_ENABLED: 'false'
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  let controlsReads = 0;
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(String(input), 'https://fixture.upstash.io/pipeline');
    assert.match(String(init?.body), /operator:controls:v1/);
    controlsReads++;
    return new Response(null, { status: 503 });
  });
  const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
  const delivery = (path: string, secret: string, body: string, pull: boolean) => {
    const payload = JSON.stringify({
      action: 'created', installation: { id: 3 },
      repository: { id: 7, full_name: 'Oddmash/fixture', private: false, visibility: 'public', owner: { login: 'Oddmash' } },
      sender: actor, issue: { number: 2, ...(pull ? { pull_request: {} } : {}) }, comment: { id: 5, user: actor, body }
    });
    return new Request('https://fixture.invalid' + path, {
      method: 'POST', body: payload,
      headers: { 'x-github-event': 'issue_comment', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex') }
    });
  };
  assert.equal((await POST(delivery('/api/github', settings.REVIEWER_WEBHOOK_SECRET, '/review', true))).status, 503);
  assert.equal(controlsReads, 1);
  assert.equal((await advisoryPost(delivery('/api/advisory?agent=triage', settings.TRIAGE_WEBHOOK_SECRET, '@oddmash-triage /triage', false))).status, 503);
  assert.equal(controlsReads, 2);
});
