import { githubRequest } from './github-request.ts';

type GuidanceFilename = 'AGENTS.md' | 'docs/AI-CODE-REVIEW.md';
type Guidance = { content: string; encoding: string };
type CacheEntry = { etag: string; data: Guidance };
export type GuidanceCache = Map<GuidanceFilename, CacheEntry>;
const warmCache: GuidanceCache = new Map();

export async function readSharedGuidance(filename: GuidanceFilename, token: string | undefined, request: typeof fetch, cache = request === fetch ? warmCache : new Map<GuidanceFilename, CacheEntry>()): Promise<Guidance | null> {
  if (!['AGENTS.md', 'docs/AI-CODE-REVIEW.md'].includes(filename)) throw new Error('Invalid organization guidance path');
  const cached = token ? cache.get(filename) : undefined;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cached ? { 'If-None-Match': cached.etag } : {}) };
  const response = await githubRequest(request, '/repos/Oddmash/.github/contents/' + filename + '?ref=main', { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) }, true);
  if (response.status === 304 && cached) return cached.data;
  if (response.status === 404) { if (token) cache.delete(filename); return null; }
  if (!response.ok) throw new Error('GitHub request failed (' + response.status + ')');
  const data = await response.json() as Partial<Guidance>;
  if (data.encoding !== 'base64' || typeof data.content !== 'string' || data.content.length > 64000) {
    if (token) cache.delete(filename);
    return null;
  }
  const value = { content: data.content, encoding: data.encoding };
  if (token) {
    const etag = response.headers.get('etag');
    if (etag && etag.length <= 256) cache.set(filename, { etag, data: value });
    else cache.delete(filename);
  }
  return value;
}
