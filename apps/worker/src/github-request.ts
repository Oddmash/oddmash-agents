import { AsyncLocalStorage } from 'node:async_hooks';

type Fetcher = typeof fetch;

function requestCategory(path: string): string {
  const pathname = path.split('?')[0] ?? '';
  if (pathname === '/app') return 'app-identity';
  if (/^\/app\/installations\/\d+\/access_tokens$/.test(pathname)) return 'installation-token-mint';
  if (pathname === '/installation/token') return 'installation-token-revoke';
  if (/^\/app\/installations\/\d+$/.test(pathname) || /^\/repos\/[^/]+\/[^/]+\/installation$/.test(pathname)) return 'installation-identity';
  if (/^\/repos\/[^/]+\/[^/]+$/.test(pathname)) return 'repository-identity';
  if (/^\/repos\/Oddmash\/\.github\/contents\//i.test(pathname)) return 'organization-guidance';
  if (/\/contents\//.test(pathname)) return 'repository-content';
  if (/\/actions\/runs(?:\/|$)/.test(pathname)) return 'workflow-runs';
  if (/\/check-runs(?:\/|$)/.test(pathname)) return 'check-runs';
  if (/\/pulls\/\d+\/files$/.test(pathname)) return 'pull-files';
  if (/\/reviews(?:\/|$)/.test(pathname)) return 'reviews';
  if (/\/pulls(?:\/|$)/.test(pathname)) return 'pull-request';
  if (/\/issues(?:\/|$)/.test(pathname)) return 'issues';
  return 'other';
}

type RequestOutcome = 'success' | 'not-modified' | 'not-found' | 'http-error' | 'network-error' | 'quota-deferred';
type RequestCount = { category: string; authenticated: boolean; read: boolean; outcome: RequestOutcome; count: number; retries: number };
const requestMetrics = new AsyncLocalStorage<Map<string, RequestCount>>();

export async function trackGitHubRequests<T>(action: () => Promise<T>, report: (counts: RequestCount[]) => void): Promise<T> {
  const counts = new Map<string, RequestCount>();
  try { return await requestMetrics.run(counts, action); }
  finally {
    try { report([...counts.values()].sort((a, b) => a.category.localeCompare(b.category) || Number(a.authenticated) - Number(b.authenticated) || Number(a.read) - Number(b.read) || a.outcome.localeCompare(b.outcome))); }
    catch { console.warn('GitHub request metrics unavailable'); }
  }
}

function recordRequest(category: string, authenticated: boolean, read: boolean, outcome: RequestOutcome, attempt: number) {
  const counts = requestMetrics.getStore();
  if (!counts) return;
  const key = [category, authenticated, read, outcome].join(':');
  const row = counts.get(key) ?? { category, authenticated, read, outcome, count: 0, retries: 0 };
  row.count++;
  if (attempt > 1) row.retries++;
  counts.set(key, row);
}

export type AuthorizationQuotaIdentity = { appId: string; installationId?: number };

function authorizationQuotaKey(identity: AuthorizationQuotaIdentity): string | undefined {
  if (!/^[1-9]\d*$/.test(identity.appId) || !Number.isSafeInteger(Number(identity.appId))) return;
  if (identity.installationId === undefined) return 'app:' + identity.appId;
  if (Number.isSafeInteger(identity.installationId) && identity.installationId > 0) return 'installation:' + identity.appId + ':' + identity.installationId;
}

function authorizationRead(identity: AuthorizationQuotaIdentity, category: string): boolean {
  return identity.installationId === undefined
    ? category === 'app-identity' || category === 'installation-identity'
    : category === 'repository-identity';
}

export function createAuthorizationQuotaCooldown(clock = Date.now) {
  const entries = new Map<string, number>();
  const now = () => Math.floor(clock() / 1000);
  const prune = () => {
    const current = now();
    for (const [key, reset] of entries) if (reset <= current) entries.delete(key);
  };
  return {
    reset(identity: AuthorizationQuotaIdentity): number | undefined {
      prune();
      const key = authorizationQuotaKey(identity);
      return key ? entries.get(key) : undefined;
    },
    remember(identity: AuthorizationQuotaIdentity, reset: number | undefined): void {
      const key = authorizationQuotaKey(identity);
      const current = now();
      if (!key || reset === undefined || !Number.isSafeInteger(reset) || reset <= current || reset - current > 3605) return;
      prune();
      const existing = entries.get(key);
      if (existing !== undefined && existing >= reset) return;
      if (existing === undefined && entries.size >= 32) entries.delete(entries.keys().next().value!);
      entries.set(key, reset);
    }
  };
}

const sharedAuthorizationCooldown = createAuthorizationQuotaCooldown();
type AuthorizationCooldown = ReturnType<typeof createAuthorizationQuotaCooldown>;
type RequestOptions = { identity?: AuthorizationQuotaIdentity; cooldown?: AuthorizationCooldown };

export function assertAuthorizationQuota(identity: AuthorizationQuotaIdentity, category: string, request: Fetcher = fetch, cooldown = request === fetch ? sharedAuthorizationCooldown : undefined) {
  if (!cooldown || !authorizationRead(identity, category)) return;
  const reset = cooldown.reset(identity);
  if (reset === undefined) return;
  recordRequest(category, true, true, 'quota-deferred', 1);
  console.warn(JSON.stringify({ event: 'github_request_deferred', category, authenticated: true, read: true, failure: 'primary-rate-limit-cooldown', reset }));
  throw new Error('GitHub request failed (403)');
}

function numericHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value || !/^\d+$/.test(value)) return;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function retryDelay(response: Response): number | undefined {
  const status = response.status;
  const retryAfter = response.headers.get('retry-after');
  const limited = status === 429 || (status === 403 && retryAfter !== null);
  if (!limited && ![500, 502, 503, 504].includes(status)) return;
  if (response.headers.get('x-ratelimit-remaining') === '0') return;
  if (retryAfter === null) return limited ? undefined : 250;
  if (!/^\d+$/.test(retryAfter)) return;
  const delay = Number(retryAfter) * 1000;
  return delay <= 2000 ? delay : undefined;
}

export async function githubRequest(request: Fetcher, path: string, init: RequestInit, optional = false, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), options: RequestOptions = {}): Promise<Response> {
  const read = (init.method ?? 'GET').toUpperCase() === 'GET';
  const authenticated = new Headers(init.headers).has('authorization');
  const category = requestCategory(path);
  const identity = options.identity;
  const cooldown = options.cooldown ?? (request === fetch ? sharedAuthorizationCooldown : undefined);
  for (let attempt = 1; ; attempt++) {
    if (read && authenticated && identity) assertAuthorizationQuota(identity, category, request, cooldown);
    let response: Response;
    try { response = await request(`https://api.github.com${path}`, init); }
    catch (error) { recordRequest(category, authenticated, read, 'network-error', attempt); throw error; }
    const outcome: RequestOutcome = response.ok ? 'success' : response.status === 304 && new Headers(init.headers).has('if-none-match') ? 'not-modified' : optional && response.status === 404 ? 'not-found' : 'http-error';
    recordRequest(category, authenticated, read, outcome, attempt);
    if (response.ok || (optional && response.status === 404) || (response.status === 304 && new Headers(init.headers).has('if-none-match'))) return response;
    const remaining = numericHeader(response.headers, 'x-ratelimit-remaining');
    const reset = numericHeader(response.headers, 'x-ratelimit-reset');
    const retryAfter = numericHeader(response.headers, 'retry-after');
    const limitedStatus = response.status === 403 || response.status === 429;
    const failure = limitedStatus && remaining === 0 ? 'primary-rate-limit' : limitedStatus && (response.status === 429 || retryAfter !== undefined) ? 'rate-limit' : 'http-error';
    if (read && authenticated && identity && failure === 'primary-rate-limit' && authorizationRead(identity, category)) cooldown?.remember(identity, reset);
    console.warn(JSON.stringify({ event: 'github_request_failed', category, status: response.status, attempt, read, authenticated, failure, remaining, reset, retryAfter }));
    const delay = read && attempt === 1 ? retryDelay(response) : undefined;
    if (delay === undefined || init.signal?.aborted) return response;
    await pause(delay);
    if (init.signal?.aborted) return response;
  }
}
