import test from 'node:test';
import assert from 'node:assert/strict';
import { roles } from '@oddmash/agent-operator-contract';
import { operatorSettings } from '../apps/worker/src/runtime-config.ts';

test('operator settings contain only explicit non-secret values', () => {
  const previous = { ...process.env };
  try {
    process.env.REVIEWER_APP_ENABLED = 'true';
    process.env.REVIEWER_APP_ID = '1234';
    process.env.REVIEWER_APP_PRIVATE_KEY = 'fixture-private-key';
    process.env.REVIEWER_APP_SLUG = 'oddmash-lead';
    process.env.OPENAI_API_KEY = 'fixture-openai-key';
    process.env.OPENAI_MODEL = 'gpt-5.4';
    const snapshot = operatorSettings();
    assert.deepEqual(snapshot.agents.map(agent => agent.role), [...roles]);
    assert.equal(snapshot.agents[0].configured, true);
    assert.equal(snapshot.agents[0].model, 'gpt-5.4');
    assert.doesNotMatch(JSON.stringify(snapshot), /fixture-|1234/);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
    Object.assign(process.env, previous);
  }
});
