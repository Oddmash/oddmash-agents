import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedModelBody, usageEvent } from '../apps/worker/src/model-request.ts';

test('role-specific budgets only tighten existing phase limits', () => {
  const payload = { max_output_tokens: 6000, input: 'sample' };
  assert.equal(JSON.parse(boundedModelBody('review', payload, {})).max_output_tokens, 6000);
  assert.equal(JSON.parse(boundedModelBody('review', payload, { REVIEWER_MAX_OUTPUT_TOKENS: '1200' })).max_output_tokens, 1200);
  assert.equal(JSON.parse(boundedModelBody('confirmation', payload, { REVIEWER_MAX_OUTPUT_TOKENS: '9000' })).max_output_tokens, 1000);
  assert.equal(JSON.parse(boundedModelBody('qa', payload, { REVIEWER_MAX_OUTPUT_TOKENS: '100' })).max_output_tokens, 1100);
  assert.equal(JSON.parse(boundedModelBody('qa', payload, { QA_MAX_OUTPUT_TOKENS: 'invalid' })).max_output_tokens, 1100);
});

test('serialized UTF-8 bytes are bounded before model transmission', () => {
  const payload = { max_output_tokens: 1000, input: '한글' };
  const body = boundedModelBody('docs', payload, {});
  const bytes = Buffer.byteLength(body, 'utf8');
  assert.equal(boundedModelBody('docs', payload, { DOCS_MAX_INPUT_BYTES: String(bytes) }), body);
  assert.throws(() => boundedModelBody('docs', payload, { DOCS_MAX_INPUT_BYTES: String(bytes - 1) }), /Model input budget exceeded/);
});

test('usage records observed counts without assuming missing usage is zero cost', () => {
  assert.deepEqual(usageEvent('discussion', 'model-name', { input_tokens: 4, output_tokens: 2, total_tokens: 6 }), { event: 'reviewer_usage', role: 'reviewer', phase: 'discussion', model: 'model-name', inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.deepEqual(usageEvent('qa', 'untrusted value', { input_tokens: -1 }), { event: 'reviewer_usage', role: 'qa', phase: 'qa', model: 'unknown', inputTokens: null, outputTokens: null, totalTokens: null });
});
