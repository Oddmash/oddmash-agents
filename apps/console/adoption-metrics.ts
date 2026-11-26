export const packages = ['@oddmash/ui', '@oddmash/juliya', 'boundra'] as const;
export const extension = 'oddmash.boundra-vscode';
export type DailyDownload = { day: string; downloads: number };
export type AdoptionMetric = { id: string; kind: 'npm' | 'marketplace'; source: string; count: number | null; history: DailyDownload[] | null; observedAt: string };
type Json = Record<string, unknown>;
const object = (value: unknown): Json | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function parseNpmHistory(payload: unknown, id: string): DailyDownload[] {
  const row = object(payload);
  if (!row || row.package !== id || !Array.isArray(row.downloads) || row.downloads.length === 0 || row.downloads.length > 31) throw new Error('Invalid npm data');
  const seen = new Set<string>();
  return row.downloads.map(raw => {
    const day = object(raw);
    if (!day || !date(day.day) || !count(day.downloads) || seen.has(day.day)) throw new Error('Invalid npm series');
    seen.add(day.day);
    return { day: day.day, downloads: day.downloads };
  }).sort((a,b) => a.day.localeCompare(b.day));
}
export function parseMarketplaceCount(payload: unknown): number {
  const results = object(payload)?.results;
  if (!Array.isArray(results)) throw new Error('Invalid Marketplace data');
  const entries = results.flatMap(result => { const extensions = object(result)?.extensions; return Array.isArray(extensions) ? extensions : []; });
  const matches = entries.filter(raw => { const row = object(raw); const publisher = object(row?.publisher)?.publisherName; return typeof publisher === 'string' && typeof row?.extensionName === 'string' && publisher + '.' + row.extensionName === extension; });
  if (matches.length !== 1) throw new Error('Extension unavailable');
  const stats = object(matches[0])?.statistics;
  if (!Array.isArray(stats)) throw new Error('Marketplace statistics unavailable');
  const install = stats.filter(raw => object(raw)?.statisticName === 'install');
  const value = object(install[0])?.value;
  if (install.length !== 1 || !count(value)) throw new Error('Install statistic unavailable');
  return value;
}
const npmSource = (id: string) => 'https://www.npmjs.com/package/' + id;
const marketplaceSource = 'https://marketplace.visualstudio.com/items?itemName=' + extension;
const readJson = async (request: typeof fetch, url: string, init: RequestInit = {}) => {
  const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error('Source unavailable');
  return response.json() as Promise<unknown>;
};
const metricIds = [...packages, extension] as const;
export async function collectAdoptionMetrics(request: typeof fetch = fetch, now = new Date(), ids: readonly string[] = metricIds): Promise<AdoptionMetric[]> {
  const observedAt = now.toISOString();
  const npm = packages.filter(id => ids.includes(id)).map(async id => {
    const metric: AdoptionMetric = {id, kind:'npm', source:npmSource(id), count:null, history:null, observedAt};
    try {
      const history = parseNpmHistory(await readJson(request, 'https://api.npmjs.org/downloads/range/last-month/' + id), id);
      const total = history.reduce((sum, item) => sum + item.downloads, 0);
      if (!count(total)) throw new Error('Invalid total');
      return {...metric, count:total, history};
    } catch { return metric; }
  });
  const marketplace = async () => {
    const metric: AdoptionMetric = {id:extension, kind:'marketplace', source:marketplaceSource, count:null, history:null, observedAt};
    try {
      const payload = await readJson(request, 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
        method:'POST', headers:{Accept:'application/json;api-version=7.2-preview.1','Content-Type':'application/json'},
        body:JSON.stringify({filters:[{criteria:[{filterType:7,value:extension}],pageNumber:1,pageSize:1}],assetTypes:[],flags:256})
      });
      return {...metric, count:parseMarketplaceCount(payload)};
    } catch { return metric; }
  };
  return Promise.all([...npm, ...(ids.includes(extension) ? [marketplace()] : [])]);
}

export function createAdoptionReader(clock: () => number = Date.now) {
  const cached = new Map<string, { expires: number; metric: AdoptionMetric }>();
  let pending: Promise<AdoptionMetric[]> | undefined;
  return async (request: typeof fetch = fetch) => {
    if (pending) return pending;
    const now = clock();
    const expired = metricIds.filter(id => (cached.get(id)?.expires ?? 0) <= now);
    const snapshot = () => metricIds.map(id => cached.get(id)!.metric);
    if (!expired.length) return snapshot();
    const promise = collectAdoptionMetrics(request, new Date(now), expired).then(metrics => {
      for (const metric of metrics) cached.set(metric.id, { expires: now + (metric.count === null ? 60_000 : 3_600_000), metric });
      return snapshot();
    });
    pending = promise;
    try { return await promise; } finally { if (pending === promise) pending = undefined; }
  };
}
export const readAdoptionMetrics = createAdoptionReader();
