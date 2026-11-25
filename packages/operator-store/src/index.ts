import { parseExecutionEvent, parseWorkerSettings, projectJobs, type ExecutionEvent, type WorkerSettings, type Job } from '@oddmash/agent-operator-contract';

type StoreConfig = { url: string; token: string };
type Status = { connected: boolean; jobs: Job[]; settings: WorkerSettings | null; settingsUpdatedAt?: string; observedAt: string };
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
  return { connected: true, jobs: projectJobs(valid, now), settings: recordedAt ? parsedSettings ?? null : null, ...(recordedAt && parsedSettings ? { settingsUpdatedAt: recordedAt } : {}), observedAt };
}
