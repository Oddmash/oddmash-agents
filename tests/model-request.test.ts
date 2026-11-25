import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedModelBody, usageEvent, recordUsage, trackModelUsage } from '../apps/worker/src/model-request.ts';

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

test('model usage tracking isolates concurrent executions and preserves missing counts on failure', async t => {
  t.mock.method(console, 'log', () => {});
  const seen: unknown[] = [];
  const first = trackModelUsage(async () => {
    recordUsage('review', 'model-name', { input_tokens: 10, output_tokens: 3 });
    await Promise.resolve();
    recordUsage('review', 'model-name', { input_tokens: 5 });
    throw new Error('fixture');
  }, usage => { seen[0] = usage; });
  const second = trackModelUsage(async () => {
    recordUsage('qa', 'model-name', { output_tokens: 2 });
  }, usage => { seen[1] = usage; });
  await Promise.all([assert.rejects(first, /fixture/), second]);
  assert.deepEqual(seen, [
    { calls: 2, inputTokens: 15, outputTokens: 3, missingInput: 0, missingOutput: 1 },
    { calls: 1, inputTokens: 0, outputTokens: 2, missingInput: 1, missingOutput: 0 }
  ]);
});
