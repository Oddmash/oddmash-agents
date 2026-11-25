type Fetcher = typeof fetch;

function requestCategory(path: string): string {
  const pathname = path.split('?')[0] ?? '';
  if (/^\/repos\/Oddmash\/\.github\/contents\//i.test(pathname)) return 'organization-guidance';
  if (/\/contents\//.test(pathname)) return 'repository-content';
  if (/\/check-runs(?:\/|$)/.test(pathname)) return 'check-runs';
  if (/\/pulls\/\d+\/files$/.test(pathname)) return 'pull-files';
  if (/\/reviews(?:\/|$)/.test(pathname)) return 'reviews';
  if (/\/pulls(?:\/|$)/.test(pathname)) return 'pull-request';
  if (/\/issues(?:\/|$)/.test(pathname)) return 'issues';
  return 'other';
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
  for (let attempt = 1; ; attempt++) {
    const response = await request(`https://api.github.com${path}`, init);
    if (response.ok || (optional && response.status === 404)) return response;
    console.warn(JSON.stringify({ event: 'github_request_failed', category: requestCategory(path), status: response.status, attempt, read }));
    const delay = read && attempt === 1 ? retryDelay(response) : undefined;
    if (delay === undefined || init.signal?.aborted) return response;
    await pause(delay);
    if (init.signal?.aborted) return response;
  }
}
