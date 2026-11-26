import type { DailyDownload } from '../adoption-metrics.ts';

export type DownloadPeriod = 7 | 30 | 'monthly';
export type DownloadPoint = { day: string; downloads: number | null; partial?: boolean };

const DAY = 86_400_000;

export function hasMonthlyHistory(history: readonly DailyDownload[]) {
  const ordered = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const firstObserved = ordered.find(point => point.downloads > 0);
  const latest = ordered.at(-1);
  return !!firstObserved && !!latest && Date.parse(latest.day) - Date.parse(firstObserved.day) >= 30 * DAY;
}

function monthlySeries(sorted: readonly DailyDownload[]) {
  const first = sorted.find(point => point.downloads > 0);
  const last = sorted.at(-1);
  if (!first || !last || !hasMonthlyHistory(sorted)) return { points: [] as DownloadPoint[], total: null, missing: 0, max: 1 };
  const start = Date.parse(first.day);
  const end = Date.parse(last.day);
  const counts = new Map(sorted.map(point => [point.day, point.downloads]));
  const points: DownloadPoint[] = [];
  let missing = 0;
  let cursor = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), 1);
  while (cursor <= end) {
    const date = new Date(cursor);
    const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    let total = 0;
    let observed = 0;
    let absent = 0;
    for (let stamp = Math.max(start, cursor); stamp <= Math.min(end, next - DAY); stamp += DAY) {
      const count = counts.get(new Date(stamp).toISOString().slice(0, 10));
      if (count === undefined) absent++;
      else { total += count; observed++; }
    }
    missing += absent;
    points.push({ day: date.toISOString().slice(0, 10), downloads: observed ? total : null, partial: start > cursor || end < next - DAY || absent > 0 });
    cursor = next;
  }
  const observed = points.flatMap(point => point.downloads === null ? [] : [point.downloads]);
  return { points, total: observed.length ? observed.reduce((sum, value) => sum + value, 0) : null, missing, max: Math.max(1, ...observed) };
}

export function downloadSeries(history: readonly DailyDownload[], period: DownloadPeriod) {
  const sorted = [...history].sort((a,b) => a.day.localeCompare(b.day));
  if (period === 'monthly') return monthlySeries(sorted);
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
