import { useState, type CSSProperties } from 'react';
import type { DailyDownload } from '../adoption-metrics';
import { downloadSeries, type DownloadPeriod } from './download-series';
import { translate, type Language } from './i18n';

export const DownloadChart = ({ history, language, period, name }: { history: readonly DailyDownload[]; language: Language; period: DownloadPeriod; name: string }) => {
  const t = (message: Parameters<typeof translate>[1]) => translate(language,message);
  const {points,total,missing,max} = downloadSeries(history,period);
  const [selected,setSelected] = useState<string>();
  const [hovered,setHovered] = useState<string>();
  const active = points.find(point => point.day === (hovered ?? selected)) ?? points.at(-1);
  const inspected = points.find(point => point.day === (hovered ?? selected));
  const tooltipPosition = inspected ? (points.indexOf(inspected)+0.5)/points.length*100 : 0;
  const fmt = (value: number | null) => value === null ? t('Unavailable') : value.toLocaleString(language);
  const day = (value: string) => new Intl.DateTimeFormat(language, {month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(value));
  if (!points.length) return <p className="muted">{t('Unavailable')}</p>;
  return <div className="download-chart">
    <div className="download-summary"><div><small className="muted">{t('Downloads in selected period')}</small><strong>{fmt(total)}</strong><small className="muted">{points[0].day} ~ {points.at(-1)?.day}</small></div><div className="download-tooltip" aria-live="polite">{active && <><span>{day(active.day)}</span><strong>{fmt(active.downloads)}</strong></>}</div></div>
    {missing > 0 && <small className="muted">{t('Missing days')}: {missing} · {t('Observed total only')}</small>}
    <div className="download-plot" data-period={period} aria-label={name + ' · ' + t('Download history')}>
      <div className="download-axis" aria-hidden="true"><span>{max.toLocaleString(language)}</span><span>0</span></div>
      <div className="download-bars" style={{'--bar-count':points.length} as CSSProperties}>
        {points.map((point,index) => <button type="button" key={point.day} className="download-bar" data-missing={point.downloads === null} data-zero={point.downloads === 0} data-selected={point.day === active?.day} aria-label={point.day + ': ' + fmt(point.downloads)} aria-pressed={point.day === selected} onMouseEnter={()=>setHovered(point.day)} onMouseLeave={()=>setHovered(undefined)} onFocus={()=>setHovered(point.day)} onBlur={()=>setHovered(undefined)} onClick={()=>setSelected(point.day)} onKeyDown={event=>{if(event.key==='Escape'){setHovered(undefined);setSelected(undefined);}}}>
          <span className="download-bar-track"><span className="download-bar-fill" style={{height:(point.downloads === null ? 0 : point.downloads/max*100)+'%'}}/></span>
          <span className="download-bar-date" aria-hidden="true">{period === 7 || index===0 || index===points.length-1 || (index%7===0 && index<points.length-3) ? point.day.slice(5).replace('-','/') : ''}</span>
        </button>)}
        {inspected && <div className="download-hover-tooltip" aria-hidden="true" style={{'--tooltip-position':tooltipPosition+'%'} as CSSProperties}><span>{day(inspected.day)}</span><strong>{fmt(inspected.downloads)}</strong></div>}
      </div>
    </div>
    <details className="download-values"><summary>{t('View daily values')}</summary><ul>{points.map(point=><li key={point.day}><time dateTime={point.day}>{point.day}</time><strong>{fmt(point.downloads)}</strong></li>)}</ul></details>
  </div>;
};
