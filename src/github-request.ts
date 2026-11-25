import { AsyncLocalStorage } from 'node:async_hooks';

type Fetcher = typeof fetch;

function requestCategory(path: string): string {
  const pathname = path.split('?')[0] ?? '';
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

type RequestOutcome = 'success' | 'not-modified' | 'not-found' | 'http-error' | 'network-error';
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
  if (!limited && ![502, 503, 504].includes(status)) return;
  if (response.headers.get('x-ratelimit-remaining') === '0') return;
  if (retryAfter === null) return limited ? undefined : 250;
  if (!/^\d+$/.test(retryAfter)) return;
  const delay = Number(retryAfter) * 1000;
  return delay <= 2000 ? delay : undefined;
}

export async function githubRequest(request: Fetcher, path: string, init: RequestInit, optional = false, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<Response> {
  const read = (init.method ?? 'GET').toUpperCase() === 'GET';
  const authenticated = new Headers(init.headers).has('authorization');
  const category = requestCategory(path);
  for (let attempt = 1; ; attempt++) {
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
    console.warn(JSON.stringify({ event: 'github_request_failed', category, status: response.status, attempt, read, authenticated, failure, remaining, reset, retryAfter }));
    const delay = read && attempt === 1 ? retryDelay(response) : undefined;
    if (delay === undefined || init.signal?.aborted) return response;
    await pause(delay);
    if (init.signal?.aborted) return response;
  }
}
