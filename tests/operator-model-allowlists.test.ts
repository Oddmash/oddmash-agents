import assert from 'node:assert/strict';
import test from 'node:test';
import { operatorModelAllowlistEntries } from '../scripts/operator-model-allowlists.mjs';

test('only explicitly configured role allowlists become plain production sync entries', () => {
  assert.deepEqual(operatorModelAllowlistEntries({ OPENAI_MODEL: 'gpt-5.4', OPENAI_API_KEY: 'fixture-only', REVIEWER_OPERATOR_ALLOWED_MODELS: '', DOCS_OPERATOR_ALLOWED_MODELS: ' ' }), []);
  const roles = ['IMPACT', 'TRIAGE', 'QA', 'RELEASE', 'DOCS', 'ARCHITECT'];
  const entries = operatorModelAllowlistEntries({ REVIEWER_OPERATOR_ALLOWED_MODELS: 'gpt-6.2-sol', ...Object.fromEntries(roles.map(role => [role + '_OPERATOR_ALLOWED_MODELS', 'gpt-5.4-mini, gpt-6.2-sol,gpt-5.4-mini'])) });
  assert.equal(entries.length, 7);
  assert.deepEqual(entries[0], { key: 'REVIEWER_OPERATOR_ALLOWED_MODELS', value: 'gpt-6.2-sol', type: 'plain' });
  for (const entry of entries.slice(1)) assert.equal(entry.value, 'gpt-5.4-mini,gpt-6.2-sol');
});

test('unknown or unauthorized model IDs fail closed, including Lead mini', () => {
  for (const value of ['gpt-5.4-mini', 'gpt-6.2-sol,', 'unapproved-model', 'gpt-6.2-sol,other']) assert.throws(() => operatorModelAllowlistEntries({ REVIEWER_OPERATOR_ALLOWED_MODELS: value }), /Unsupported approved model configuration/);
  assert.throws(() => operatorModelAllowlistEntries({ QA_OPERATOR_ALLOWED_MODELS: 'gpt-5.4-mini,gpt-unapproved' }), /Unsupported approved model configuration/);
});
