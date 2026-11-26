import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, EmptyState } from '@oddmash/ui';
import type { AgentRole, Job } from '@oddmash/agent-operator-contract';
import type { ContributorSnapshot } from '../contributor-pulls';
import { executionLabel, executionTone } from './execution-status';
import { translate, type Language } from './i18n';

export const ContributorPulls = ({ language, jobs, renderAgent }: { language: Language; jobs: readonly Job[]; renderAgent: (role: AgentRole) => ReactNode }) => {
  const t = (label: Parameters<typeof translate>[1]) => translate(language, label);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ContributorSnapshot>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setFailed(false);
    setData(undefined);
    fetch('/api/contributors', { cache: 'no-store', signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error('Unavailable'); return await response.json() as ContributorSnapshot; })
      .then(value => { if (!abort.signal.aborted) setData(value); })
      .catch(() => { if (!abort.signal.aborted) setFailed(true); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision]);
  return <section className="detail-view">
    <div className="detail-intro"><p className="muted view-description">{t('Open public pull requests from external contributors. Agent states show retained observations, not current GitHub approval.')}</p><Button variant="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t('Refresh')}</Button></div>
    {loading && <p role="status">{t('Loading status…')}</p>}
    {failed && <Alert tone="danger" role="alert">{t('Contributor pull requests unavailable. Try again later.')}</Alert>}
    {data && <><p className="muted">{t('Last observed:')} <time dateTime={data.observedAt}>{new Date(data.observedAt).toLocaleString(language)}</time></p>
      {data.partial && <Alert tone="warning">{t('Results may be incomplete.')}</Alert>}
      {data.pulls.length === 0 && <Card><EmptyState>{t('No matching open contributor pull requests.')}</EmptyState></Card>}
      <div className="review-list">{data.pulls.map(pull => {
        const latest = new Map<AgentRole, Job>();
        for (const job of jobs) {
          if (job.role === 'triage' || job.target?.repository.toLowerCase() !== pull.repository.toLowerCase() || job.target.number !== pull.number) continue;
          const previous = latest.get(job.role);
          if (!previous || Date.parse(job.updatedAt) > Date.parse(previous.updatedAt)) latest.set(job.role, job);
        }
        return <Card className="review-group" key={pull.repository + '#' + pull.number}>
          <div className="review-target-row"><div className="review-target-identity"><small className="muted">{pull.repository} #{pull.number} · @{pull.author}</small><h3><a href={'https://github.com/' + pull.repository + '/pull/' + pull.number} target="_blank" rel="noreferrer">{pull.title}</a></h3><small className="muted">{t('Updated')} <time dateTime={pull.updatedAt}>{new Date(pull.updatedAt).toLocaleString(language)}</time></small></div><Badge tone="neutral">{t(pull.draft === true ? 'Draft pull request' : 'Open pull request')}</Badge></div>
          {latest.size ? <ul className="review-agents">{[...latest.values()].map(job => <li className="execution-entry" key={job.role}><div className="execution-summary"><div>{renderAgent(job.role)}</div><Badge tone={executionTone(job.state)}>{executionLabel(language, job.state, job.role)}</Badge></div></li>)}</ul> : <p className="muted">{t('No retained agent activity for this pull request.')}</p>}
          <a href={'https://github.com/' + pull.repository + '/pull/' + pull.number + '/checks'} target="_blank" rel="noreferrer">{t('View GitHub checks')}</a>
        </Card>;
      })}</div>
    </>}
  </section>;
};
