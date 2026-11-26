import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, EmptyState } from '@oddmash/ui';
import type { AgentRole, Job } from '@oddmash/agent-operator-contract';
import type { ContributorSnapshot, ContributorWorkflow } from '../contributor-pulls';
import { executionLabel, executionTone } from './execution-status';
import { translate, type Language } from './i18n';
import './contributor-pulls.css';
import { Chevron } from './chevron';

type IndicatorState = 'running' | 'waiting' | 'done' | 'failed' | 'neutral';
const StatusBadge = ({ state, tone, children }: { state: IndicatorState; tone: 'active' | 'warning' | 'success' | 'danger' | 'neutral' | 'info'; children: ReactNode }) => <Badge tone={tone}><span className="contributor-indicator" data-state={state} aria-hidden="true">{state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'waiting' ? '·' : ''}</span>{children}</Badge>;
const workflowLabel = (workflow?: ContributorWorkflow): Parameters<typeof translate>[1] => workflow?.state === 'running' ? 'Checks running' : workflow?.state === 'failed' ? 'Workflow failure reported' : workflow?.state === 'action-required' ? 'Workflow approval or action required' : workflow?.state === 'waiting' ? 'Workflow waiting' : workflow?.state === 'reported' ? 'Checks reported' : 'Workflow status unavailable';
const ContributorSkeleton = ({ language }: { language: Language }) => <div className="contributor-loading" role="status" aria-label={translate(language, 'Loading status…')}><p className="muted contributor-loading-meta" aria-hidden="true"><span/></p><div className="review-list">{[1, 2, 3].map(key => <Card className="review-group contributor-card" key={key}><div aria-hidden="true" className="contributor-placeholder-header"><div><span/><span/></div><span/></div></Card>)}</div></div>;
const freshnessMs = 60_000;
const liveRefreshMs = 65_000;

export const ContributorPulls = ({ active, language, jobs, renderAgent, onAccessLost }: { active: boolean; language: Language; jobs: readonly Job[]; renderAgent: (role: AgentRole) => ReactNode; onAccessLost: () => void }) => {
  const t = (label: Parameters<typeof translate>[1]) => translate(language, label);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ContributorSnapshot>();
  const [failed, setFailed] = useState(false);
  const freshUntil = useRef(0);
  const liveUntil = useRef(0);
  const refresh = () => { freshUntil.current = 0; setRevision(value => value + 1); };
  useEffect(() => {
    if (!active) return;
    if (Date.now() < freshUntil.current) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    const timeout = AbortSignal.timeout(15_000);
    const signal = AbortSignal.any([abort.signal, timeout]);
    setLoading(true);
    setFailed(false);
    fetch('/api/contributors', { cache: 'no-store', signal })
      .then(async response => {
        if (response.status === 401 || response.status === 403) {
          if (!signal.aborted) onAccessLost();
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        return await response.json() as ContributorSnapshot;
      })
      .then(value => {
        if (!value || signal.aborted) return;
        freshUntil.current = Date.now() + freshnessMs;
        liveUntil.current = value.pulls.some(pull => pull.evidence?.workflow.state === 'running') ? Date.now() + liveRefreshMs : 0;
        setData(value);
      })
      .catch(() => { if (!abort.signal.aborted) setFailed(true); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [active, revision, onAccessLost]);
  useEffect(() => {
    if (!active || loading || failed || !liveUntil.current) return;
    const wake = () => {
      if (!document.hidden && Date.now() >= liveUntil.current) {
        freshUntil.current = 0;
        setRevision(value => value + 1);
      }
    };
    const timer = window.setTimeout(wake, Math.max(0, liveUntil.current - Date.now()));
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [active, data, loading, failed]);
  if (!active) return null;
  const jobsByPull = new Map<string, Map<AgentRole, Job>>();
  for (const job of jobs) {
    if (!job.target || job.role === 'triage') continue;
    const key = job.target.repository.toLowerCase() + '#' + job.target.number;
    const byRole = jobsByPull.get(key) ?? new Map<AgentRole, Job>();
    const previous = byRole.get(job.role);
    if (!previous || Date.parse(job.updatedAt) > Date.parse(previous.updatedAt)) byRole.set(job.role, job);
    jobsByPull.set(key, byRole);
  }
  return <section className="detail-view">
    <div className="detail-intro contributor-toolbar"><p className="muted view-description">{t('Open pull requests from external contributors.')}</p><Button variant="secondary" aria-disabled={loading} onClick={() => { if (!loading) refresh(); }}>{t('Refresh')}</Button></div>
    {loading && !data && <ContributorSkeleton language={language}/>}
    {loading && data && <small role="status" className="muted">{t('Refreshing…')}</small>}
    {failed && <Alert tone="danger" role="alert">{t('Contributor pull requests unavailable. Try again later.')}{data && t(' Showing the last successful snapshot.')}</Alert>}
    {data && <><p className="muted">{t('Last observed:')} <time dateTime={data.observedAt}>{new Date(data.observedAt).toLocaleString(language)}</time></p>
      {data.partial && <Alert tone="neutral">{t('Results may be incomplete.')}</Alert>}
      {data.pulls.length === 0 && !data.partial && <Card><EmptyState>{t('No matching open contributor pull requests.')}</EmptyState></Card>}
      <div className="review-list">{data.pulls.map(pull => {
        const latest = jobsByPull.get(pull.repository.toLowerCase() + '#' + pull.number);
        const workflow = pull.evidence?.workflow;
        const reviewStatus = pull.evidence?.reviewStatus;
        const newestLeadReview = pull.evidence?.reviews.find(review => review.role === 'reviewer' && review.currentHead);
        const statusIsNewer = reviewStatus && (!newestLeadReview || Date.parse(reviewStatus.updatedAt) >= Date.parse(newestLeadReview.submittedAt));
        const runningReview = latest?.get('reviewer')?.state === 'running';
        const activeChecks = workflow?.state === 'running' || workflow?.state === 'waiting' || workflow?.state === 'action-required';
        const statusLink = 'https://github.com/' + pull.repository + '/pull/' + pull.number + '#issuecomment-';
        const runLink = 'https://github.com/' + pull.repository + '/actions/runs/' + workflow?.id;
        return <Card className="review-group contributor-card" key={pull.repository + '#' + pull.number}>
          <details className="contributor-evidence">
            <summary className="review-target-row"><span className="review-target-identity"><strong>{pull.title}</strong><small className="muted">{pull.repository} #{pull.number} · @{pull.author}</small></span><span className="contributor-overview-status"><Badge tone={workflow?.state === 'failed' ? 'danger' : workflow?.state === 'running' ? 'active' : activeChecks ? 'warning' : 'neutral'}>{t(workflowLabel(workflow))}</Badge>{pull.draft === true && <Badge tone="neutral">{t('Draft pull request')}</Badge>}<Chevron disclosure/></span></summary>
            <div className="contributor-status">
              <div className="contributor-evidence-links"><a href={'https://github.com/' + pull.repository + '/pull/' + pull.number} target="_blank" rel="noreferrer">{t('View pull request')}</a><a href={'https://github.com/' + pull.repository + '/pull/' + pull.number + '/checks'} target="_blank" rel="noreferrer">{t('View GitHub checks')}</a><small className="muted">{t('Updated')} <time dateTime={pull.updatedAt}>{new Date(pull.updatedAt).toLocaleString(language)}</time></small></div>
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
            {latest?.size ? <details className="contributor-history"><summary>{t('Retained agent execution history')}</summary><ul className="review-agents">{[...latest.values()].map(job => <li className="execution-entry" key={job.role}><div className="execution-summary"><div>{renderAgent(job.role)}</div><StatusBadge state={job.state === 'running' ? 'running' : job.state === 'failed' ? 'failed' : job.state === 'returned' || job.state === 'published' ? 'done' : 'neutral'} tone={executionTone(job.state)}>{executionLabel(language, job.state, job.role)}</StatusBadge></div></li>)}</ul></details> : null}
          </details>
        </Card>;
      })}</div>
    </>}
  </section>;
};
