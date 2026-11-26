export type ContributorPull = { repository: string; number: number; title: string; author: string; updatedAt: string; draft: boolean | null };
export type ContributorSnapshot = { pulls: ContributorPull[]; observedAt: string; partial: boolean };

const externalAssociations = new Set(['CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'NONE']);
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function parseContributorPulls(payload: unknown, ownerId: string, observedAt: string): ContributorSnapshot {
  const data = record(payload);
  if (!data || !Array.isArray(data.items) || typeof data.total_count !== 'number' || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || typeof data.incomplete_results !== 'boolean') throw new Error('Invalid public search response');
  const pulls: ContributorPull[] = [];
  let partial = data.incomplete_results || data.total_count > data.items.length || data.items.length > 100;
  for (const item of data.items.slice(0, 100)) {
    const row = record(item);
    const user = record(row?.user);
    if (!row || !user || !record(row.pull_request)) { partial = true; continue; }
    if (row.state !== 'open' || user.type !== 'User' || String(user.id) === ownerId || typeof row.author_association !== 'string' || !externalAssociations.has(row.author_association)) continue;
    const repository = typeof row.repository_url === 'string' ? /^https:\/\/api\.github\.com\/repos\/(Oddmash\/[A-Za-z0-9_.-]+)$/i.exec(row.repository_url)?.[1] : undefined;
    if (!repository || typeof row.number !== 'number' || !Number.isSafeInteger(row.number) || row.number < 1 || typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || typeof row.title !== 'string' || typeof user.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(user.login) || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) { partial = true; continue; }
    pulls.push({ repository, number: row.number, title: row.title.slice(0, 300), author: user.login, updatedAt: row.updated_at, draft: typeof row.draft === 'boolean' ? row.draft : null });
  }
  return { pulls, observedAt, partial };
}

let cached: { owner: string; expires: number; value: ContributorSnapshot } | undefined;
let pending: { owner: string; promise: Promise<ContributorSnapshot> } | undefined;
export async function readContributorPulls(owner: string, request: typeof fetch = fetch): Promise<ContributorSnapshot> {
  if (!/^[1-9]\d*$/.test(owner)) throw new Error('Missing owner');
  if (cached?.owner === owner && cached.expires > Date.now()) return cached.value;
  if (pending?.owner === owner) return pending.promise;
  const promise = (async () => {
    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', 'org:Oddmash is:pr is:open is:public');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '100');
    const response = await request(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Oddmash-Console', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Public search unavailable');
    const value = parseContributorPulls(await response.json(), owner, new Date().toISOString());
    cached = { owner, expires: Date.now() + 60_000, value };
    return value;
  })();
  pending = { owner, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}
