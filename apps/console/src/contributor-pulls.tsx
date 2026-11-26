import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, EmptyState } from '@oddmash/ui';
import type { AgentRole, Job } from '@oddmash/agent-operator-contract';
import type { ContributorSnapshot, ContributorWorkflow } from '../contributor-pulls';
import { executionLabel, executionTone } from './execution-status';
import { translate, type Language } from './i18n';
import './contributor-pulls.css';

type IndicatorState = 'running' | 'waiting' | 'done' | 'failed' | 'neutral';
const StatusBadge = ({ state, tone, children }: { state: IndicatorState; tone: 'active' | 'warning' | 'success' | 'danger' | 'neutral' | 'info'; children: ReactNode }) => <Badge tone={tone}><span className="contributor-indicator" data-state={state} aria-hidden="true">{state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'waiting' ? '·' : ''}</span>{children}</Badge>;
const workflowLabel = (workflow?: ContributorWorkflow): Parameters<typeof translate>[1] => workflow?.state === 'running' ? 'Checks running' : workflow?.state === 'failed' ? 'Workflow failure reported' : workflow?.state === 'action-required' ? 'Workflow approval or action required' : workflow?.state === 'waiting' ? 'Workflow waiting' : workflow?.state === 'reported' ? 'Checks reported' : 'Workflow status unavailable';
const ContributorSkeleton = ({ language }: { language: Language }) => <div className="contributor-loading" role="status" aria-label={translate(language, 'Loading status…')}><p className="muted contributor-loading-meta" aria-hidden="true"><span/></p><div className="review-list">{Array.from({length:3}, (_, index) => <Card className="review-group contributor-card" key={index}><div aria-hidden="true" className="contributor-placeholder"><div className="contributor-placeholder-header"><div><span/><span/><span/></div><span/></div><div className="contributor-status-row"><span/><span/></div><div className="contributor-status-row"><span/><span/></div><div className="contributor-placeholder-footer"><span/><span/></div></div></Card>)}</div></div>;

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
    fetch('/api/contributors', { cache: 'no-store', signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error('Unavailable'); return await response.json() as ContributorSnapshot; })
      .then(value => { if (!abort.signal.aborted) setData(value); })
      .catch(() => { if (!abort.signal.aborted) { setFailed(true); setData(undefined); } })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    if (loading || failed || !data?.pulls.some(pull => pull.evidence?.workflow.state === 'running')) return;
    const timer = window.setTimeout(() => { if (document.visibilityState === 'visible') setRevision(value => value + 1); }, 65_000);
    return () => window.clearTimeout(timer);
  }, [data, loading, failed]);
  return <section className="detail-view">
    <div className="detail-intro"><p className="muted view-description">{t('Open public contributor pull requests. GitHub review evidence and retained executions are shown separately.')}</p><Button variant="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t('Refresh')}</Button></div>
    {loading && !data && <ContributorSkeleton language={language}/>}
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
        const workflow = pull.evidence?.workflow;
        const reviewStatus = pull.evidence?.reviewStatus;
        const newestLeadReview = pull.evidence?.reviews.find(review => review.role === 'reviewer' && review.currentHead);
        const statusIsNewer = reviewStatus && (!newestLeadReview || Date.parse(reviewStatus.updatedAt) >= Date.parse(newestLeadReview.submittedAt));
        const runningReview = latest.get('reviewer')?.state === 'running';
        const activeChecks = workflow?.state === 'running' || workflow?.state === 'waiting' || workflow?.state === 'action-required';
        const statusLink = 'https://github.com/' + pull.repository + '/pull/' + pull.number + '#issuecomment-';
        const runLink = 'https://github.com/' + pull.repository + '/actions/runs/' + workflow?.id;
        return <Card className="review-group contributor-card" key={pull.repository + '#' + pull.number}>
          <div className="review-target-row"><div className="review-target-identity"><small className="muted">{pull.repository} #{pull.number} · @{pull.author}</small><h3><a href={'https://github.com/' + pull.repository + '/pull/' + pull.number} target="_blank" rel="noreferrer">{pull.title}</a></h3><small className="muted">{t('Updated')} <time dateTime={pull.updatedAt}>{new Date(pull.updatedAt).toLocaleString(language)}</time></small></div><Badge tone="neutral">{t(pull.draft === true ? 'Draft pull request' : 'Open pull request')}</Badge></div>
          <div className="contributor-status">
            <div className="contributor-status-row"><strong>{t('GitHub Actions')}</strong><div className="contributor-status-values">
              {workflow?.id ? <a className="contributor-workflow-link" href={runLink} target="_blank" rel="noreferrer"><StatusBadge state={workflow.state === 'running' ? 'running' : workflow.state === 'failed' ? 'failed' : activeChecks ? 'waiting' : 'neutral'} tone={workflow.state === 'running' ? 'active' : workflow.state === 'failed' ? 'danger' : activeChecks ? 'warning' : 'neutral'}>{t(workflowLabel(workflow))}</StatusBadge></a> : <StatusBadge state="neutral" tone="neutral">{t(workflowLabel(workflow))}</StatusBadge>}
              {workflow?.name && <small className="muted">{workflow.name}{workflow.attempt ? ' · ' + t('Attempt') + ' ' + workflow.attempt : ''}</small>}
            </div></div>
            {workflow?.state === 'failed' && <div className="contributor-failures"><strong>{t('Failed jobs and steps')}</strong>{workflow.failures?.length ? <ul>{workflow.failures.map(failure => <li key={failure.jobId}><a href={runLink + '/job/' + failure.jobId} target="_blank" rel="noreferrer">{failure.job}{failure.step ? ' / ' + failure.step : ''}</a><small>{failure.conclusion}</small></li>)}</ul> : <small>{t('Failure details unavailable. Open the workflow run.')}</small>}</div>}
            <div className="contributor-status-row"><strong>{t('GitHub review')}</strong><div className="contributor-status-values">
              {runningReview && <StatusBadge state="running" tone="active">{t('Review execution running (observed)')}</StatusBadge>}
              {activeChecks && <StatusBadge state="waiting" tone="warning">{t('Waiting on current checks')}</StatusBadge>}
              {statusIsNewer && reviewStatus && <a className="contributor-review-link" href={statusLink + reviewStatus.id} target="_blank" rel="noreferrer">{renderAgent('reviewer')}<StatusBadge state={activeChecks || runningReview ? 'neutral' : reviewStatus.state === 'failed' ? 'failed' : 'done'} tone={activeChecks || runningReview ? 'neutral' : reviewStatus.state === 'failed' ? 'danger' : 'success'}>{t(activeChecks || runningReview ? 'Previous review attempt' : reviewStatus.state === 'failed' ? 'Review processing failed' : 'Review processing completed')}</StatusBadge>{!activeChecks && reviewStatus.reason === 'checks-failed' && <small>{t('Required CI checks failed')}</small>}</a>}
              {pull.evidence?.reviews.length ? pull.evidence.reviews.map(review => <a key={review.role} className="contributor-review-link" href={'https://github.com/' + pull.repository + '/pull/' + pull.number + '#pullrequestreview-' + review.id} target="_blank" rel="noreferrer">{renderAgent(review.role)}<StatusBadge state={review.currentHead && !activeChecks && !runningReview ? review.state === 'APPROVED' ? 'done' : review.state === 'CHANGES_REQUESTED' ? 'failed' : 'neutral' : 'neutral'} tone={review.currentHead && !activeChecks && review.state === 'APPROVED' ? 'success' : review.currentHead && !activeChecks && review.state === 'CHANGES_REQUESTED' ? 'danger' : 'neutral'}>{t(review.currentHead ? activeChecks || runningReview ? 'Previous review posted' : review.state === 'APPROVED' ? 'Approved' : review.state === 'CHANGES_REQUESTED' ? 'Changes requested' : review.state === 'DISMISSED' ? 'Review dismissed' : 'Review posted' : 'Older revision review')}</StatusBadge></a>) : !statusIsNewer && !activeChecks && !runningReview ? <StatusBadge state="neutral" tone="neutral">{t(pull.evidence?.reviewsComplete ? 'No agent review reported' : 'Review status unavailable')}</StatusBadge> : null}
              {pull.evidence?.reviews.length && !pull.evidence.reviewsComplete ? <small className="muted">{t('Results may be incomplete.')}</small> : null}
            </div></div>
            {pull.evidence && <small className="muted">{t('Last observed:')} <time dateTime={pull.evidence.observedAt}>{new Date(pull.evidence.observedAt).toLocaleString(language)}</time></small>}
          </div>
          {latest.size ? <details className="contributor-history"><summary>{t('Retained agent execution history')}</summary><ul className="review-agents">{[...latest.values()].map(job => <li className="execution-entry" key={job.role}><div className="execution-summary"><div>{renderAgent(job.role)}</div><StatusBadge state={job.state === 'running' ? 'running' : job.state === 'failed' ? 'failed' : job.state === 'returned' || job.state === 'published' ? 'done' : 'neutral'} tone={executionTone(job.state)}>{executionLabel(language, job.state, job.role)}</StatusBadge></div></li>)}</ul></details> : null}
          <a className="contributor-checks" href={'https://github.com/' + pull.repository + '/pull/' + pull.number + '/checks'} target="_blank" rel="noreferrer">{t('View GitHub checks')}</a>
        </Card>;
      })}</div>
    </>}
  </section>;
};
