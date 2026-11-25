import { createHash } from 'node:crypto';
import { githubRequest } from './github-request.ts';

type GuidanceFilename = 'AGENTS.md' | 'docs/AI-CODE-REVIEW.md';
type Guidance = { content: string; encoding: string; type?: string; path?: string; sha?: string; size?: number };
type CacheEntry = { etag: string; data: Guidance; tokenKey: string; until: number };
export type GuidanceCache = Map<GuidanceFilename, CacheEntry>;
const warmCache: GuidanceCache = new Map();
const inFlight = new WeakMap<GuidanceCache, Map<string, Promise<Guidance | null>>>();

function validGuidance(value: Guidance, filename: GuidanceFilename): boolean {
  if (value.encoding !== 'base64' || typeof value.content !== 'string' || value.content.length > 64000 || value.type !== 'file' || value.path !== filename || !/^[a-f0-9]{40}$/.test(value.sha ?? '')) return false;
  const encoded = value.content.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || value.size !== bytes.length || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== value.sha) return false;
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); return Boolean(text.trim()) && !text.includes('\0'); } catch { return false; }
}

export async function readSharedGuidance(filename: GuidanceFilename, token: string | undefined, request: typeof fetch, cache = request === fetch ? warmCache : new Map<GuidanceFilename, CacheEntry>()): Promise<Guidance | null> {
  if (!['AGENTS.md', 'docs/AI-CODE-REVIEW.md'].includes(filename)) throw new Error('Invalid organization guidance path');
  if (!token) return fetchSharedGuidance(filename, undefined, request, cache);
  const tokenKey = createHash('sha256').update(token).digest('hex');
  let pending = inFlight.get(cache);
  if (!pending) { pending = new Map(); inFlight.set(cache, pending); }
  const key = filename + ':' + tokenKey;
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = fetchSharedGuidance(filename, token, request, cache, tokenKey);
  pending.set(key, operation);
  try { return await operation; }
  catch (error) {
    if (cache.get(filename)?.tokenKey === tokenKey) cache.delete(filename);
    throw error;
  }
  finally { pending.delete(key); }
}

async function fetchSharedGuidance(filename: GuidanceFilename, token: string | undefined, request: typeof fetch, cache: GuidanceCache, tokenKey?: string): Promise<Guidance | null> {
  const entry = tokenKey ? cache.get(filename) : undefined;
  const cached = entry && entry.tokenKey === tokenKey && entry.until > Date.now() ? entry : undefined;
  if (entry && !cached) cache.delete(filename);
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cached ? { 'If-None-Match': cached.etag } : {}) };
  const response = await githubRequest(request, '/repos/Oddmash/.github/contents/' + filename + '?ref=main', { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) }, true);
  if (response.status === 304 && cached) {
    if (validGuidance(cached.data, filename)) return cached.data;
    cache.delete(filename);
    throw new Error('Organization guidance integrity unavailable');
  }
  if (response.status === 404) {
    if (token) { cache.delete(filename); throw new Error('Organization guidance unavailable'); }
    return null;
  }
  if (!response.ok) throw new Error('GitHub request failed (' + response.status + ')');
  const data = await response.json() as Partial<Guidance>;
  if (data.encoding !== 'base64' || typeof data.content !== 'string' || data.content.length > 64000) {
    if (token) { cache.delete(filename); throw new Error('Organization guidance integrity unavailable'); }
    return null;
  }
  const value: Guidance = { content: data.content, encoding: data.encoding, type: data.type, path: data.path, sha: data.sha, size: data.size };
  if (!validGuidance(value, filename)) {
    if (token) { cache.delete(filename); throw new Error('Organization guidance integrity unavailable'); }
    return null;
  }
  if (token) {
    const etag = response.headers.get('etag');
    if (etag && etag.length <= 256) cache.set(filename, { etag, data: value, tokenKey: tokenKey!, until: Date.now() + 600000 });
    else cache.delete(filename);
  }
  return value;
}
