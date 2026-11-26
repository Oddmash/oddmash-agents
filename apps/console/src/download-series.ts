import type { DailyDownload } from '../adoption-metrics.ts';

export type DownloadPeriod = 7 | 30;
export type DownloadPoint = { day: string; downloads: number | null };

export function downloadSeries(history: readonly DailyDownload[], period: DownloadPeriod) {
  const sorted = [...history].sort((a,b) => a.day.localeCompare(b.day));
  const last = sorted.at(-1);
  if (!last) return { points: [], total: null, missing: period, max: 1 };
  const counts = new Map(sorted.map(point => [point.day,point.downloads]));
  const end = Date.parse(last.day);
  const points: DownloadPoint[] = Array.from({length:period},(_,index) => {
    const day = new Date(end - (period-1-index)*86_400_000).toISOString().slice(0,10);
    return {day,downloads:counts.get(day) ?? null};
  });
  const observed = points.flatMap(point => point.downloads === null ? [] : [point.downloads]);
  return {points,total:observed.length ? observed.reduce((sum,count)=>sum+count,0) : null,missing:period-observed.length,max:Math.max(1,...observed)};
}
