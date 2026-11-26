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

export const organizationStart = '2026-04-23T04:38:00Z';

export const localCalendarDate = (date: Date): string => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');

export const historyBounds = (now = new Date()) => ({ min: localCalendarDate(new Date(organizationStart)), max: localCalendarDate(now) });

export const selectRangeDate = (range: DateRange, endpoint: keyof DateRange, day: string): DateRange => ({ ...range, [endpoint]: day ? day + 'T' + (range[endpoint].slice(11) || (endpoint === 'from' ? '00:00:00' : '23:59:59')) : '' });

export const setRangeTime = (range: DateRange, endpoint: keyof DateRange, time: string): DateRange => ({ ...range, [endpoint]: range[endpoint].slice(0, 10) + 'T' + (time.length === 5 ? time + ':00' : time) });

export function historyPreset(days: number, now = new Date()): DateRange {
  const { min, max } = historyBounds(now);
  const from = new Date(now);
  from.setDate(from.getDate() - Math.max(0, days - 1));
  const start = localCalendarDate(from);
  return { from: (start < min ? min : start) + 'T00:00:00', to: max + 'T23:59:59' };
}

export function validHistoryRange(range: DateRange, now = new Date()): boolean {
  const { min, max } = historyBounds(now);
  return resolveDateRange(range) !== undefined && Object.values(range).every(value => !value || (value.slice(0, 10) >= min && value.slice(0, 10) <= max));
}
