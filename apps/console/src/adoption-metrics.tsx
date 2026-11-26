import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '@oddmash/ui';
import type { AdoptionMetric } from '../adoption-metrics';
import { translate, type Language } from './i18n';

export const AdoptionMetrics = ({ language }: { language: Language }) => {
  const t = (message: Parameters<typeof translate>[1]) => translate(language,message);
  const [revision, setRevision] = useState(0);
  const [metrics, setMetrics] = useState<AdoptionMetric[]>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setFailed(false);
    setMetrics(undefined);
    fetch('/api/adoption', {cache:'no-store',signal:abort.signal})
      .then(async response => {if (!response.ok) throw new Error('Unavailable'); return await response.json() as {metrics: AdoptionMetric[]};})
      .then(data => {if (!abort.signal.aborted) setMetrics(data.metrics);})
      .catch(() => {if (!abort.signal.aborted) setFailed(true);})
      .finally(() => {if (!abort.signal.aborted) setLoading(false);});
    return () => abort.abort();
  }, [revision]);
  return <section className="detail-view">
    <div className="detail-intro"><h2>{t('Public product adoption')}</h2><Button variant="secondary" disabled={loading} onClick={() => setRevision(v => v + 1)}>{t('Refresh')}</Button></div>
    <p className="muted view-description">{t('Public aggregate counts are not unique users. Missing values are unavailable, not zero.')}</p>
    {loading && <p role="status">{t('Loading status…')}</p>}
    {failed && <Alert role="alert" tone="danger">{t('Product adoption metrics unavailable.')}</Alert>}
    {metrics && <div className="review-list">{metrics.map(metric => <Card key={metric.id} className="review-group">
      <div className="detail-intro"><h3><a href={metric.source} target="_blank" rel="noreferrer">{metric.id}</a></h3><strong>{metric.count === null ? t('Unavailable') : metric.count.toLocaleString(language)}</strong></div>
      <p className="muted">{t(metric.kind === 'npm' ? 'Downloads in reported month' : 'Marketplace reported installs')} · {t('Last observed:')} <time dateTime={metric.observedAt}>{new Date(metric.observedAt).toLocaleString(language)}</time></p>
      {metric.history?.length ? <details className="execution-details"><summary>{t('Daily download history')}</summary><dl className="execution-facts">{metric.history.map(day => <div key={day.day}><dt><time dateTime={day.day}>{day.day}</time></dt><dd>{day.downloads.toLocaleString(language)}</dd></div>)}</dl></details> : metric.kind === 'marketplace' ? <p className="muted">{t('Historical observations are retained in the daily collection runs.')}</p> : null}
    </Card>)}</div>}
    <a href="https://github.com/Oddmash/oddmash-agents/actions/workflows/public-adoption-metrics.yml" target="_blank" rel="noreferrer">{t('Daily collection history')}</a>
  </section>;
};
