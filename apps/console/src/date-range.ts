export type DateRange = { from: string; to: string };

export function parseLocalDateTime(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return;
  const local = new Date(0);
  local.setFullYear(year, month - 1, day);
  local.setHours(hour, minute, second, 0);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day ||
      local.getHours() !== hour || local.getMinutes() !== minute || local.getSeconds() !== second) return;
  return local.getTime();
}

export function resolveDateRange(range: DateRange): { from: number; to: number } | undefined {
  const from = range.from === '' ? -Infinity : parseLocalDateTime(range.from);
  const to = range.to === '' ? Infinity : parseLocalDateTime(range.to);
  if (from === undefined || to === undefined || from > to) return;
  return { from, to: to === Infinity ? to : to + 999 };
}

export function matchesDateRange(timestamp: string, range: DateRange): boolean {
  const bounds = resolveDateRange(range);
  const time = Date.parse(timestamp);
  return Boolean(bounds && Number.isFinite(time) && time >= bounds.from && time <= bounds.to);
}

export const emptyDateRange = (): DateRange => ({ from: '', to: '' });
