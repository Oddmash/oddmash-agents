import { randomUUID } from 'node:crypto';
import { defaultControls, optionalRoles, primaryRoles, parseControlsRecord, parseOperatorControls, type ControlsRecord, type OperatorControls } from '../../operator-contract/src/controls.ts';
import { parseModelOverrides, parseOperatorModelsRecord, type ModelOverrides, type OperatorModelsRecord } from '../../operator-contract/src/model-settings.ts';
import { parseExecutionEvent, parseWorkerSettings, projectJobs, projectModelUsage, type ExecutionEvent, type WorkerSettings, type Job } from '../../operator-contract/src/index.ts';

type StoreConfig = { url: string; token: string };
type Status = { connected: boolean; jobs: Job[]; usage?: ReturnType<typeof projectModelUsage>; settings: WorkerSettings | null; settingsUpdatedAt?: string; observedAt: string };
const eventKey = 'oddmash:operator:events:v1';
const settingsKey = 'oddmash:operator:settings:v1';
const retention = 604800;
const limit = 500;

export function operatorStoreConfig(url: string | undefined, token: string | undefined): StoreConfig | undefined {
  if (!url || !token) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.upstash\.io$/i.test(parsed.hostname) || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return;
    return { url: parsed.origin, token };
  } catch { return; }
}

async function pipeline(config: StoreConfig, commands: (string | number)[][], request: typeof fetch): Promise<unknown[]> {
  const response = await request(config.url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, body: JSON.stringify(commands), redirect: 'error', signal: AbortSignal.timeout(2500), cache: 'no-store' });
  if (!response.ok) throw new Error('Operator store unavailable');
  const data = await response.json() as unknown;
  if (!Array.isArray(data) || data.length !== commands.length || data.some(item => !item || typeof item !== 'object' || !Object.hasOwn(item, 'result'))) throw new Error('Operator store unavailable');
  return data.map(item => item.result);
}

export async function writeOperatorEvent(config: StoreConfig, event: ExecutionEvent, settings: WorkerSettings, request = fetch): Promise<void> {
  const safeEvent = parseExecutionEvent(event);
  const safeSettings = parseWorkerSettings(settings);
  if (!safeEvent || !safeSettings) return;
  await pipeline(config, [['LPUSH', eventKey, JSON.stringify(safeEvent)], ['LTRIM', eventKey, 0, limit - 1], ['EXPIRE', eventKey, retention], ['SET', settingsKey, JSON.stringify({ settings: safeSettings, recordedAt: safeEvent.timestamp }), 'EX', retention]], request);
}

function decode(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 4096) return;
  try { return JSON.parse(value); } catch { return; }
}

export async function readOperatorStatus(config: StoreConfig | undefined, request = fetch, now = Date.now()): Promise<Status> {
  const observedAt = new Date(now).toISOString();
  if (!config) return { connected: false, jobs: [], settings: null, observedAt };
  const [events, settings] = await pipeline(config, [['LRANGE', eventKey, 0, limit - 1], ['GET', settingsKey]], request);
  if (!Array.isArray(events)) throw new Error('Operator store unavailable');
  const valid = events.slice(0, limit).map(decode).map(parseExecutionEvent).filter(event => event && now - Date.parse(event.timestamp) <= retention * 1000 && Date.parse(event.timestamp) <= now + 60000);
  const snapshot = decode(settings);
  const record = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : undefined;
  const parsedSettings = parseWorkerSettings(record?.settings);
  const recordedAt = typeof record?.recordedAt === 'string' && Number.isFinite(Date.parse(record.recordedAt)) && Date.parse(record.recordedAt) <= now + 60000 && now - Date.parse(record.recordedAt) <= retention * 1000 ? new Date(record.recordedAt).toISOString() : undefined;
  return { connected: true, jobs: projectJobs(valid, now), usage: projectModelUsage(valid), settings: recordedAt ? parsedSettings ?? null : null, ...(recordedAt && parsedSettings ? { settingsUpdatedAt: recordedAt } : {}), observedAt };
}

const controlsKey = 'oddmash:operator:controls:v1';
const auditKey = 'oddmash:operator:controls-audit:v1';

export async function readOperatorControls(config: StoreConfig, request = fetch): Promise<ControlsRecord> {
  const [value] = await pipeline(config, [['GET', controlsKey]], request);
  if (value === null) return { revision: null, controls: defaultControls(), updatedAt: null };
  const parsed = parseControlsRecord(decode(value));
  if (!parsed) throw new Error('Operator controls unavailable');
  return parsed;
}

const saveControlsScript = `
local previous = redis.call('GET', KEYS[1])
if previous then
  local current = cjson.decode(previous)
  if current.revision ~= ARGV[1] then return 0 end
elseif ARGV[1] ~= '' then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, 49)
return 1
`;

export async function saveOperatorControls(config: StoreConfig, expectedRevision: string | null, controls: OperatorControls, ownerId: string, request = fetch): Promise<ControlsRecord | null> {
  const safe = parseOperatorControls(controls);
  if (!safe || !/^[1-9]\d*$/.test(ownerId) || expectedRevision !== null && !/^[a-f0-9-]{36}$/.test(expectedRevision)) throw new Error('Invalid controls');
  const record = { revision: randomUUID(), controls: safe, updatedAt: new Date().toISOString() };
  // Keep the v1 controls payload readable by older deploys during rollback.
  const pausedPrimaryRoles = primaryRoles.filter(role => safe.excludedRoles.includes(role));
  const persisted = { ...record, controls: { ...safe, excludedRoles: optionalRoles.filter(role => safe.excludedRoles.includes(role)) }, ...(pausedPrimaryRoles.length ? { pausedPrimaryRoles } : {}) };
  const audit = { ...persisted, ownerId };
  const [result] = await pipeline(config, [['EVAL', saveControlsScript, 2, controlsKey, auditKey, expectedRevision ?? '', JSON.stringify(persisted), JSON.stringify(audit)]], request);
  if (result === 0) return null;
  if (result !== 1) throw new Error('Operator controls unavailable');
  return record;
}

const modelSettingsKey = 'oddmash:operator:models:v1';
const modelAuditKey = 'oddmash:operator:models-audit:v1';

export async function readOperatorModels(config: StoreConfig, request = fetch): Promise<OperatorModelsRecord> {
  const [value] = await pipeline(config, [['GET', modelSettingsKey]], request);
  if (value === null) return { revision: null, overrides: {}, updatedAt: null };
  const parsed = parseOperatorModelsRecord(decode(value));
  if (!parsed) throw new Error('Operator model settings unavailable');
  return parsed;
}

export async function saveOperatorModels(config: StoreConfig, expectedRevision: string | null, overrides: ModelOverrides, ownerId: string, request = fetch): Promise<OperatorModelsRecord | null> {
  const safe = parseModelOverrides(overrides);
  if (!safe || !/^[1-9]\d*$/.test(ownerId) || expectedRevision !== null && !/^[a-f0-9-]{36}$/.test(expectedRevision)) throw new Error('Invalid model settings');
  const record = { revision: randomUUID(), overrides: safe, updatedAt: new Date().toISOString() };
  const audit = { ...record, ownerId };
  const [result] = await pipeline(config, [['EVAL', saveControlsScript, 2, modelSettingsKey, modelAuditKey, expectedRevision ?? '', JSON.stringify(record), JSON.stringify(audit)]], request);
  if (result === 0) return null;
  if (result !== 1) throw new Error('Operator model settings unavailable');
  return record;
}
