import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, EmptyState } from '@oddmash/ui';
import type { AgentRole, Job } from '@oddmash/agent-operator-contract';
import type { ContributorSnapshot } from '../contributor-pulls';
import { executionLabel, executionTone } from './execution-status';
import { translate, type Language } from './i18n';
import './contributor-pulls.css';

const ContributorSkeleton = ({ language }: { language: Language }) => <div className="review-list contributor-loading" role="status" aria-label={translate(language, 'Loading status…')}>{Array.from({length:3}, (_, index) => <Card className="review-group contributor-card" key={index}><div aria-hidden="true" className="contributor-placeholder"><div className="contributor-placeholder-header"><div><span/><span/><span/></div><span/></div><div className="contributor-status-row"><span/><span/></div><div className="contributor-status-row"><span/><span/></div><div className="contributor-placeholder-footer"><span/></div></div></Card>)}</div>;

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
    <div className="detail-intro"><p className="muted view-description">{t('Open public contributor pull requests. GitHub review evidence and retained executions are shown separately.')}</p><Button variant="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t('Refresh')}</Button></div>
    {loading && <ContributorSkeleton language={language}/>}
    {failed && <Alert tone="danger" role="alert">{t('Contributor pull requests unavailable. Try again later.')}</Alert>}
    {data && <><p className="muted">{t('Last observed:')} <time dateTime={data.observedAt}>{new Date(data.observedAt).toLocaleString(language)}</time></p>
      {data.partial && <Alert tone="neutral">{t('Results may be incomplete.')}</Alert>}
      {data.pulls.length === 0 && <Card><EmptyState>{t('No matching open contributor pull requests.')}</EmptyState></Card>}
      <div className="review-list">{data.pulls.map(pull => {
        const latest = new Map<AgentRole, Job>();
        for (const job of jobs) {
          if (job.role === 'triage' || job.target?.repository.toLowerCase() !== pull.repository.toLowerCase() || job.target.number !== pull.number) continue;
          const previous = latest.get(job.role);
          if (!previous || Date.parse(job.updatedAt) > Date.parse(previous.updatedAt)) latest.set(job.role, job);
        }
        return <Card className="review-group contributor-card" key={pull.repository + '#' + pull.number}>
          <div className="review-target-row"><div className="review-target-identity"><small className="muted">{pull.repository} #{pull.number} · @{pull.author}</small><h3><a href={'https://github.com/' + pull.repository + '/pull/' + pull.number} target="_blank" rel="noreferrer">{pull.title}</a></h3><small className="muted">{t('Updated')} <time dateTime={pull.updatedAt}>{new Date(pull.updatedAt).toLocaleString(language)}</time></small></div><Badge tone="neutral">{t(pull.draft === true ? 'Draft pull request' : 'Open pull request')}</Badge></div>
          <div className="contributor-status">
            <div className="contributor-status-row"><strong>{t('GitHub review')}</strong><div className="contributor-status-values">{pull.evidence?.reviews.length ? pull.evidence.reviews.map(review => <a key={review.role} className="contributor-review-link" href={'https://github.com/' + pull.repository + '/pull/' + pull.number + '#pullrequestreview-' + review.id} target="_blank" rel="noreferrer">{renderAgent(review.role)}<Badge tone={review.currentHead && review.state === 'APPROVED' ? 'success' : review.currentHead && review.state === 'CHANGES_REQUESTED' ? 'danger' : 'neutral'}>{t(review.currentHead ? review.state === 'APPROVED' ? 'Approved' : review.state === 'CHANGES_REQUESTED' ? 'Changes requested' : review.state === 'DISMISSED' ? 'Review dismissed' : 'Review posted' : 'Older revision review')}</Badge></a>) : <Badge tone="neutral">{t(pull.evidence?.reviewsComplete ? 'No agent review reported' : 'Review status unavailable')}</Badge>}{pull.evidence?.reviews.length && !pull.evidence.reviewsComplete ? <small className="muted">{t('Results may be incomplete.')}</small> : null}</div></div>
            <div className="contributor-status-row"><strong>{t('GitHub Actions')}</strong><div className="contributor-status-values">{pull.evidence?.workflow.state === 'action-required' || pull.evidence?.workflow.state === 'waiting' ? <a className="contributor-workflow-link" href={'https://github.com/' + pull.repository + '/actions/runs/' + pull.evidence.workflow.id} target="_blank" rel="noreferrer"><Badge tone="warning">{t(pull.evidence.workflow.state === 'action-required' ? 'Workflow approval or action required' : 'Workflow waiting')}</Badge></a> : <Badge tone={pull.evidence?.workflow.state === 'running' ? 'active' : pull.evidence?.workflow.state === 'failed' ? 'danger' : 'neutral'}>{t(pull.evidence?.workflow.state === 'running' ? 'Checks running' : pull.evidence?.workflow.state === 'failed' ? 'Workflow failure reported' : pull.evidence?.workflow.state === 'reported' ? 'Checks reported' : 'Workflow status unavailable')}</Badge>}</div></div>
            {pull.evidence && <small className="muted">{t('Last observed:')} <time dateTime={pull.evidence.observedAt}>{new Date(pull.evidence.observedAt).toLocaleString(language)}</time></small>}
          </div>
          {latest.size ? <ul className="review-agents">{[...latest.values()].map(job => <li className="execution-entry" key={job.role}><div className="execution-summary"><div>{renderAgent(job.role)}</div><Badge tone={executionTone(job.state)}>{executionLabel(language, job.state, job.role)}</Badge></div></li>)}</ul> : null}
          <a className="contributor-checks" href={'https://github.com/' + pull.repository + '/pull/' + pull.number + '/checks'} target="_blank" rel="noreferrer">{t('View GitHub checks')}</a>
        </Card>;
      })}</div>
    </>}
  </section>;
};
