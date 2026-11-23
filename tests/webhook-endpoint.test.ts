import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { POST } from '../api/github.ts';

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
