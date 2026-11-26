import { useState } from 'react';
import { Button, DateRangePicker, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose, Alert } from '@oddmash/ui';
import { emptyDateRange, resolveDateRange, type DateRange } from './date-range';
import type { Language } from './i18n';
import './date-range-filter.css';

const messages = {
  en: { label: 'Date and time', all: 'All dates', from: 'From', to: 'To', clear: 'Clear range', apply: 'Apply filter', cancel: 'Cancel', year: 'Year', month: 'Month', day: 'Day', hour: 'Hour', minute: 'Minute', second: 'Second', clearPart: 'Clear date', calendar: 'Calendar', previousMonth: 'Previous month', nextMonth: 'Next month', today: 'Today', invalid: 'Enter a valid date range. The start must be before or equal to the end.', note: 'Execution records are filtered by last update in your local time zone.', unbounded: 'Any time' },
  ko: { label: '날짜 및 시간', all: '모든 날짜', from: '시작', to: '종료', clear: '범위 초기화', apply: '필터 적용', cancel: '취소', year: '연', month: '월', day: '일', hour: '시', minute: '분', second: '초', clearPart: '날짜 지우기', calendar: '달력', previousMonth: '이전 달', nextMonth: '다음 달', today: '오늘', invalid: '유효한 날짜 범위를 입력하세요. 시작 시각은 종료 시각과 같거나 이전이어야 합니다.', note: '현지 시간대의 마지막 갱신 시각으로 실행 기록을 필터링합니다.', unbounded: '제한 없음' }
} as const;

export const DateRangeFilter = ({ value, onApply, language, timeZone }: { value: DateRange; onApply: (range: DateRange) => void; language: Language; timeZone: string }) => {
  const w = messages[language];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const valid = resolveDateRange(draft) !== undefined;
  const reversed = Boolean(draft.from && draft.to && draft.from > draft.to);
  const label = value.from || value.to ? (value.from ? value.from.replace('T', ' ') : w.unbounded) + ' ~ ' + (value.to ? value.to.replace('T', ' ') : w.unbounded) : w.all;
  const labels = { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute, second: w.second, clear: w.clearPart, calendar: w.calendar, previousMonth: w.previousMonth, nextMonth: w.nextMonth, today: w.today };
  return <div className="filter-control date-range-control"><span>{w.label}</span>
    <Dialog open={open} onOpenChange={next => { if (next) setDraft(value); setOpen(next); }}>
      <DialogTrigger asChild><Button type="button" variant="secondary" aria-label={w.label + ': ' + label}>{label}</Button></DialogTrigger>
      <DialogContent className="date-range-dialog" onEscapeKeyDown={event => { if (event.target instanceof Element && event.target.closest('[data-om-calendar-panel]')) event.preventDefault(); }}>
        <DialogTitle>{w.label}</DialogTitle>
        <DialogDescription>{w.note} ({timeZone})</DialogDescription>
        <div className="date-range-fields">
          <DateRangePicker value={{ start: draft.from, end: draft.to }} label={w.label} startLabel={w.from} endLabel={w.to} labels={labels} locale={language} withTime invalidMessage={w.invalid} onValueChange={range => setDraft({ from: range.start, to: range.end })}/>
          {!valid && !reversed && <Alert tone="danger">{w.invalid}</Alert>}
        </div>
        <div className="date-range-actions"><Button type="button" variant="secondary" onClick={() => setDraft(emptyDateRange())}>{w.clear}</Button><DialogClose asChild><Button variant="secondary" type="button">{w.cancel}</Button></DialogClose><Button disabled={!valid} type="button" onClick={() => { if (!valid) return; onApply(draft); setOpen(false); }}>{w.apply}</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
};
