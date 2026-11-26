import { useState } from 'react';
import { Button, DateCalendar, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose, Alert, Input } from '@oddmash/ui';
import { emptyDateRange, historyBounds, historyPreset, selectRangeDate, setRangeTime, validHistoryRange, type DateRange } from './date-range';
import type { Language } from './i18n';
import './date-range-filter.css';

const messages = {
  en: { label: 'Date range', all: 'All dates', from: 'From', to: 'To', clear: 'Clear range', apply: 'Apply filter', cancel: 'Cancel', clearPart: 'Clear date', previousMonth: 'Previous month', nextMonth: 'Next month', today: 'Today', week: 'Last 7 days', month: 'Last 30 days', advanced: 'Exact time (optional)', invalid: 'Choose a valid range within the available dates. The start must be before or equal to the end.', note: 'Execution records are filtered by last update in your local time zone.', unbounded: 'Any time' },
  ko: { label: '날짜 범위', all: '모든 날짜', from: '시작', to: '종료', clear: '범위 초기화', apply: '필터 적용', cancel: '취소', clearPart: '날짜 지우기', previousMonth: '이전 달', nextMonth: '다음 달', today: '오늘', week: '최근 7일', month: '최근 30일', advanced: '정확한 시간 설정 (선택)', invalid: '선택 가능한 날짜 범위에서 시작 시각이 종료 시각과 같거나 이전이어야 합니다.', note: '현지 시간대의 마지막 갱신 시각으로 실행 기록을 필터링합니다.', unbounded: '제한 없음' }
} as const;

export const DateRangeFilter = ({ value, onApply, language, timeZone }: { value: DateRange; onApply: (range: DateRange) => void; language: Language; timeZone: string }) => {
  const w = messages[language];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const bounds = historyBounds();
  const valid = validHistoryRange(draft);
  const label = value.from || value.to ? (value.from ? value.from.replace('T', ' ') : w.unbounded) + ' ~ ' + (value.to ? value.to.replace('T', ' ') : w.unbounded) : w.all;
  const labels = { previousMonth: w.previousMonth, nextMonth: w.nextMonth, today: w.today };
  return <div className="filter-control date-range-control"><span>{w.label}</span>
    <Dialog open={open} onOpenChange={next => { if (next) setDraft(value); setOpen(next); }}>
      <DialogTrigger asChild><Button type="button" variant="secondary" aria-label={w.label + ': ' + label}>{label}</Button></DialogTrigger>
      <DialogContent className="date-range-dialog">
        <DialogTitle>{w.label}</DialogTitle>
        <DialogDescription>{w.note} ({timeZone})</DialogDescription>
        <div className="date-range-presets" role="group" aria-label={w.label}>
          <Button type="button" variant="secondary" onClick={() => setDraft(emptyDateRange())}>{w.all}</Button>
          {([[1, w.today], [7, w.week], [30, w.month]] as const).map(([days, title]) => <Button type="button" variant="secondary" key={days} onClick={() => setDraft(historyPreset(days))}>{title}</Button>)}
        </div>
        <div className="date-range-fields">{(['from', 'to'] as const).map(endpoint => <section className="date-calendar-endpoint" key={endpoint} aria-label={w[endpoint]}>
          <div className="date-calendar-heading"><strong>{w[endpoint]}</strong><Button type="button" variant="ghost" disabled={!draft[endpoint]} aria-label={w[endpoint] + ': ' + w.clearPart} onClick={() => setDraft(previous => selectRangeDate(previous, endpoint, ''))}>{w.clearPart}</Button></div>
          <span>{draft[endpoint] ? draft[endpoint].slice(0, 10) : w.unbounded}</span>
          <DateCalendar value={draft[endpoint].slice(0, 10)} onValueChange={day => setDraft(previous => selectRangeDate(previous, endpoint, day))} minDate={bounds.min} maxDate={bounds.max} locale={language} labels={labels} aria-label={w[endpoint]}/>
        </section>)}</div>
        <details className="date-time-advanced"><summary>{w.advanced}</summary><div>{(['from', 'to'] as const).map(endpoint => <label key={endpoint}>{w[endpoint]}<Input type="time" step={1} disabled={!draft[endpoint]} value={draft[endpoint].slice(11)} onChange={event => setDraft(previous => setRangeTime(previous, endpoint, event.target.value))}/></label>)}</div></details>
        {!valid && <Alert tone="danger">{w.invalid}</Alert>}
        <div className="date-range-actions"><Button type="button" variant="secondary" onClick={() => setDraft(emptyDateRange())}>{w.clear}</Button><DialogClose asChild><Button variant="secondary" type="button">{w.cancel}</Button></DialogClose><Button disabled={!valid} type="button" onClick={() => { if (!valid) return; onApply(draft); setOpen(false); }}>{w.apply}</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
};
