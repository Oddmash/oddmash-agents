import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card } from '@oddmash/ui';
import type { AdoptionMetric } from '../adoption-metrics';
import { DownloadChart } from './download-chart';
import type { DownloadPeriod } from './download-series';
import './console-polish.css';
import { translate, type Language } from './i18n';

export const AdoptionMetrics = ({ language, active = true }: { language: Language; active?: boolean }) => {
  const t = (message: Parameters<typeof translate>[1]) => translate(language,message);
  const [period,setPeriod] = useState<DownloadPeriod>(7);
  const [revision, setRevision] = useState(0);
  const [metrics, setMetrics] = useState<AdoptionMetric[]>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const expires = useRef(0);
  const lastGood = useRef(new Map<string, AdoptionMetric>());
  const [stale, setStale] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => setRevision(value => value + 1), Math.max(1000, expires.current - Date.now())); };
    if (Date.now() < expires.current) {
      setLoading(false);
      schedule();
    } else {
      setLoading(true);
      setFailed(false);
      fetch('/api/adoption', {cache:'no-store',signal:abort.signal})
        .then(async response => {if (!response.ok) throw new Error('Unavailable'); return await response.json() as {metrics: AdoptionMetric[]};})
        .then(data => {
          if (abort.signal.aborted) return;
          const freshness = data.metrics.map(metric => Date.parse(metric.observedAt) + (metric.count === null ? 60_000 : 3_600_000)).filter(Number.isFinite);
          expires.current = Math.max(Date.now()+1000, Math.min(...freshness, Date.now()+3_600_000));
          const staleIds = new Set<string>();
          const display = data.metrics.map(metric => {
            if (metric.count !== null) { lastGood.current.set(metric.id, metric); return metric; }
            const previous = lastGood.current.get(metric.id);
            if (!previous) return metric;
            staleIds.add(metric.id);
            return previous;
          });
          setStale(staleIds);
          setMetrics(display);
        })
        .catch(() => {if (!abort.signal.aborted) { expires.current = Date.now()+60_000; setFailed(true); }})
        .finally(() => {if (!abort.signal.aborted) { setLoading(false); schedule(); }});
    }
    return () => { abort.abort(); clearTimeout(timer); };
  }, [active, revision]);
  return <section className="detail-view adoption-section">
    <div className="detail-intro"><h2>{t('Public product adoption')}</h2><div className="adoption-actions"><div role="group" aria-label={t('Download period')} className="download-period">{([7,30] as const).map(value=><Button key={value} variant={period===value?'primary':'secondary'} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{t(value===7?'Week':'Month')}</Button>)}</div><Button variant="secondary" disabled={loading} onClick={() => { expires.current = 0; setRevision(v => v + 1); }}>{t('Refresh')}</Button></div></div>
    <p className="muted view-description">{t('Public aggregate counts are not unique users. Missing values are unavailable, not zero.')}</p>
    {loading && !metrics && <div role="status" aria-label={t('Loading status…')} className="review-list" aria-busy="true">{[1,2,3].map(key=><Card key={key} className="adoption-card"><span className="skeleton-line"/><span className="skeleton-line adoption-skeleton-chart"/></Card>)}</div>}{loading && metrics && <small role="status" className="muted">{t('Refreshing…')}</small>}
    {failed && <Alert role="alert" tone="danger">{t('Product adoption metrics unavailable.')}{metrics && t(' Showing the last successful snapshot.')}</Alert>}
    {metrics && <div className="review-list">{metrics.map(metric => <Card key={metric.id} className="review-group adoption-card">
      <div className="detail-intro adoption-card-heading"><h3><a href={metric.source} target="_blank" rel="noreferrer">{metric.id}</a></h3><div className="adoption-reported-total"><small className="muted">{t(metric.kind === 'npm' ? 'Downloads in reported month' : 'Marketplace reported installs')}</small><strong>{metric.count === null ? t('Unavailable') : metric.count.toLocaleString(language)}</strong></div></div>
      <p className="muted adoption-observed">{t('Last observed:')} <time dateTime={metric.observedAt}>{new Date(metric.observedAt).toLocaleString(language)}</time></p>
      {stale.has(metric.id) && <Alert>{t('Last successful data; latest refresh unavailable.')}</Alert>}
      {metric.history?.length ? <DownloadChart history={metric.history} name={metric.id} language={language} period={period}/> : metric.kind === 'marketplace' ? <p className="muted">{t('Historical observations are retained in the daily collection runs.')}</p> : <p className="muted adoption-observed">{t('The npm download service has not returned statistics for this package. Try again later.')}</p>}
    </Card>)}</div>}
    <a href="https://github.com/Oddmash/oddmash-agents/actions/workflows/public-adoption-metrics.yml" target="_blank" rel="noreferrer">{t('Daily collection history')}</a>
  </section>;
};
