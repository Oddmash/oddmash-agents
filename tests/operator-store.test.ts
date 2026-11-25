import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorStoreConfig, readOperatorStatus, writeOperatorEvent } from '@oddmash/agent-operator-store';
import { roles, type ExecutionEvent } from '@oddmash/agent-operator-contract';
import { isAuthorizedOwner } from '../apps/console/auth-policy.ts';

const settings = { queueEnabled: true, coordinatedAdvisoriesEnabled: false, agents: roles.map(role => ({ role, enabled: true, configured: true, model: 'gpt-5.4', autoMerge: false })) };
const now = Date.parse('2026-11-25T05:00:00Z');
const event: ExecutionEvent = { event: 'oddmash_agent_execution', role: 'reviewer', correlationId: 'a'.repeat(24), attempt: 1, retryCount: 0, timestamp: new Date(now).toISOString(), outcome: 'started' };
const config = operatorStoreConfig('https://fixture.upstash.io', 'fixture-token')!;

test('owner authorization requires exact configured GitHub identity', () => {
  assert.equal(isAuthorizedOwner(123, '123'), true);
  assert.equal(isAuthorizedOwner('123', '123'), true);
  assert.equal(isAuthorizedOwner('123', undefined), false);
  assert.equal(isAuthorizedOwner('qtaghdi', '123'), false);
  assert.equal(isAuthorizedOwner('124', '123'), false);
  assert.equal(isAuthorizedOwner('0', '0'), false);
});

test('store is disabled without valid dedicated endpoint and token', async () => {
  assert.equal(operatorStoreConfig('https://example.com', 'fixture-token'), undefined);
  assert.equal(operatorStoreConfig('https://fixture.upstash.io/path', 'fixture-token'), undefined);
  assert.equal(operatorStoreConfig('https://fixture.upstash.io', undefined), undefined);
  const status = await readOperatorStatus(undefined, async () => { throw new Error('unexpected network'); }, now);
  assert.equal(status.connected, false);
  assert.deepEqual(status.jobs, []);
});

test('writes only safe bounded execution data and reads actual state', async () => {
  await writeOperatorEvent(config, { ...event, unknown: 'fixture-private' } as ExecutionEvent, settings, async (url, init) => {
    assert.equal(String(url), 'https://fixture.upstash.io/pipeline');
    const commands = JSON.parse(String(init?.body));
    assert.deepEqual(commands.map((entry: unknown[]) => entry[0]), ['LPUSH', 'LTRIM', 'EXPIRE', 'SET']);
    assert.doesNotMatch(String(init?.body), /fixture-private|fixture-token/);
    assert.equal(commands[1][3], 499);
    return Response.json(commands.map(() => ({ result: 'OK' })));
  });
  const status = await readOperatorStatus(config, async (_url, init) => {
    const commands = JSON.parse(String(init?.body));
    assert.deepEqual(commands.map((entry: unknown[]) => entry[0]), ['LRANGE', 'GET']);
    return Response.json([{ result: [JSON.stringify({ ...event, ignored: 'fixture-private' })] }, { result: JSON.stringify({ settings, recordedAt: event.timestamp }) }]);
  }, now);
  assert.equal(status.connected, true);
  assert.equal(status.jobs[0].state, 'running');
  assert.equal(status.settings?.agents.length, 7);
  assert.equal(status.settingsUpdatedAt, event.timestamp);
  assert.doesNotMatch(JSON.stringify(status), /fixture-private|fixture-token/);
});
