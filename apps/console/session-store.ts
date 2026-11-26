import { SESSION_LIFETIME_MS, MAX_RETAINED_FAMILIES, type SessionState } from './session-family.ts';

type Config = { url: string; token: string };
const namespace = 'oddmash:operator:sessions:v1:';
const compareAndSetScript = `local current = redis.call('GET', KEYS[1])
if (current or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`;

export interface SessionStore {
  read(): Promise<string | null>;
  compareAndSet(expected: string | null, next: string): Promise<boolean>;
}

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseSessionState(raw: string | null, ownerId: string): SessionState {
  if (raw === null) return { families: [] };
  if (raw.length > 512_000) throw new Error('Session state unavailable');
  let parsed: SessionState;
  try { parsed = JSON.parse(raw) as SessionState; } catch { throw new Error('Session state unavailable'); }
  if (!parsed || !Array.isArray(parsed.families) || parsed.families.length > MAX_RETAINED_FAMILIES) throw new Error('Session state unavailable');
  const ids = new Set<string>(), bootstraps = new Set<string>();
  for (const f of parsed.families) {
    if (!f || typeof f.id !== 'string' || !/^[a-f0-9]{32}$/.test(f.id) || ids.has(f.id) || f.ownerId !== ownerId || !digest(f.bootstrapDigest) || bootstraps.has(f.bootstrapDigest) || !digest(f.accessDigest) || !digest(f.refreshDigest) || !stamp(f.issuedAt) || !stamp(f.expiresAt) || f.expiresAt !== f.issuedAt + SESSION_LIFETIME_MS || !stamp(f.accessExpiresAt) || f.accessExpiresAt < f.issuedAt || f.accessExpiresAt > f.expiresAt || typeof f.revoked !== 'boolean' || !Array.isArray(f.spent) || f.spent.length > 128 || f.spent.some(entry => !entry || !digest(entry.digest) || !stamp(entry.replacedAt) || entry.replacedAt < f.issuedAt || entry.replacedAt >= f.expiresAt)) throw new Error('Session state unavailable');
    ids.add(f.id); bootstraps.add(f.bootstrapDigest);
  }
  return { families: parsed.families.map(f => ({ id: f.id, bootstrapDigest: f.bootstrapDigest, ownerId: f.ownerId, issuedAt: f.issuedAt, expiresAt: f.expiresAt, accessExpiresAt: f.accessExpiresAt, accessDigest: f.accessDigest, refreshDigest: f.refreshDigest, spent: f.spent.map(entry => ({ digest: entry.digest, replacedAt: entry.replacedAt })), revoked: f.revoked })) };
}

export function createSessionStore(config: Config, ownerId: string, request = fetch): SessionStore {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.upstash\.io$/i.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !config.token || !/^[1-9]\d*$/.test(ownerId)) throw new Error('Session store unavailable');
  const key = namespace + ownerId;
  const command = async (args: (string | number)[]) => {
    const response = await request(url.origin + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, body: JSON.stringify([args]), redirect: 'error', signal: AbortSignal.timeout(2500), cache: 'no-store' });
    if (!response.ok) throw new Error('Session store unavailable');
    const result = await response.json() as unknown;
    if (!Array.isArray(result) || result.length !== 1 || !result[0] || typeof result[0] !== 'object' || !Object.hasOwn(result[0], 'result') || Object.hasOwn(result[0], 'error')) throw new Error('Session store unavailable');
    return result[0].result as unknown;
  };
  return {
    async read() { const value = await command(['GET', key]); if (value !== null && typeof value !== 'string') throw new Error('Session store unavailable'); return value; },
    async compareAndSet(expected, next) {
      const result = await command(['EVAL', compareAndSetScript, 1, key, expected ?? '', next, SESSION_LIFETIME_MS]);
      if (result !== 0 && result !== 1) throw new Error('Session store unavailable');
      return result === 1;
    }
  };
}

export async function transactSession<T extends { state: SessionState; outcome: string }>(store: SessionStore, ownerId: string, transition: (state: SessionState) => T): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await store.read();
    const state = parseSessionState(raw, ownerId);
    const result = transition(state);
    if (JSON.stringify(state) === JSON.stringify(result.state)) return result;
    if (await store.compareAndSet(raw, JSON.stringify(result.state))) return result;
  }
  throw new Error('Session store contention');
}
