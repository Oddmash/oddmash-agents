import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Card } from '@oddmash/ui';
import { jobElapsedMs, type AgentRole, type Job } from '@oddmash/agent-operator-contract';
import { executionLabel, executionTone } from './execution-status';
import { activitySummary, repositoryActivity, type groupActivity } from './activity';
import { WorkflowView } from './workflow-view';
import { executionCount, korean, translate, type Language, type Message } from './i18n';
import { visibleTargetSelection, toggleTargetSelection } from './target-selection';
import { Chevron } from './chevron';
import { Collapsible } from './collapsible';
import './repository-target.css';

type TargetGroup = ReturnType<typeof groupActivity>[number] & { total: number };

const timestamp = (value: string | undefined, language: Language) => value ? <time dateTime={value}>{new Date(value).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'medium' })}</time> : '—';

const elapsed = (job: Job, language: Language, observedAt: string) => {
  const duration = jobElapsedMs(job, observedAt);
  if (duration === undefined) return '—';
  const seconds = Math.round(duration / 1000);
  const formatter = new Intl.NumberFormat(language, { minimumIntegerDigits: 2, useGrouping: false });
  const rest = formatter.format(seconds % 60);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? Math.floor(minutes / 60) + ':' + formatter.format(minutes % 60) + ':' + rest : minutes + ':' + rest;
};

const JobDetails = ({ job, language, observedAt }: { job: Job; language: Language; observedAt: string }) => {
  const t = (message: Message) => translate(language, message);
  const usage = job.usage;
  return <details className="execution-details">
    <summary>{t('Execution details')}</summary>
    <dl className="execution-facts">
      <div><dt>{t('Queued at')}</dt><dd>{timestamp(job.queuedAt, language)}</dd></div>
      <div><dt>{t('Started at')}</dt><dd>{timestamp(job.startedAt, language)}</dd></div>
      <div><dt>{t('Finished at')}</dt><dd>{timestamp(job.finishedAt, language)}</dd></div>
      <div><dt>{t('Updated')}</dt><dd>{timestamp(job.updatedAt, language)}</dd></div>
      <div><dt>{t('Elapsed')}</dt><dd className="elapsed-number">{elapsed(job, language, observedAt)}</dd></div>
      <div><dt>{t('Retries')}</dt><dd>{job.attempt - 1}</dd></div>
      {usage && <><div><dt>{t('Observed calls:')}</dt><dd>{usage.calls.toLocaleString(language)}</dd></div><div><dt>{t('Known input tokens:')}</dt><dd>{usage.inputTokens.toLocaleString(language)} <small>{usage.missingInput ? t('Incomplete') : ''}</small></dd></div><div><dt>{t('Known output tokens:')}</dt><dd>{usage.outputTokens.toLocaleString(language)} <small>{usage.missingOutput ? t('Incomplete') : ''}</small></dd></div></>}
    </dl>
    {job.phaseHistory?.length ? <><h4>{t('Observed phases')}</h4><ol className="phase-history">{job.phaseHistory.map((item, index) => <li key={item.timestamp + ':' + index}><span>{t(item.phase)}</span>{timestamp(item.timestamp, language)}</li>)}</ol></> : null}
  </details>;
};

const ExecutionEntry = ({ job, language, observedAt, live, agent }: { job: Job; language: Language; observedAt: string; live: boolean; agent: ReactNode }) => {
  const t = (message: Message) => translate(language, message);
  const [clock, setClock] = useState(observedAt);
  const active = live && (job.state === 'queued' || job.state === 'running');
  useEffect(() => {
    setClock(observedAt);
    if (!active) return;
    const origin = Date.parse(observedAt);
    const received = Date.now();
    const tick = () => {
      if (!document.hidden) setClock(new Date(origin + Date.now() - received).toISOString());
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [observedAt, active]);
  return <li className="execution-entry" data-state={job.state}>
          <div className="execution-summary">
            <div>{agent}</div>
            <div className="review-phase"><strong>{job.phase ? t(job.phase) : t('Not reported')}</strong><small>{t('Attempt')} {job.attempt} · <span className="elapsed-number">{elapsed(job, language, clock)}</span></small></div>
            <div className="review-state"><Badge tone={executionTone(job.state)}>{live && job.state === 'running' && <span className="activity-spinner" aria-hidden="true"/>}{executionLabel(language, job.state, job.role)}</Badge>{job.failure && <small>{Object.hasOwn(korean, job.failure) ? t(job.failure as Message) : t('unexpected')}</small>}<small>{timestamp(job.updatedAt, language)}</small></div>
          </div>
          <JobDetails job={job} language={language} observedAt={clock}/>
        </li>;
};

export const RepositoryActivity = ({ collapsed, onToggle, groups, visibleJobs, observedAt, live, language, renderAgent, initialSelection }: { initialSelection?: string; collapsed: ReadonlySet<string>; onToggle: (key: string) => void; groups: TargetGroup[]; visibleJobs: readonly Job[]; observedAt: string; live: boolean; language: Language; renderAgent: (role: AgentRole) => ReactNode }) => {
  const t = (message: Message) => translate(language, message);
  const repositories = repositoryActivity(visibleJobs);
  const [selection, setSelection] = useState<string | null | undefined>(() => visibleTargetSelection(groups, initialSelection));
  const visibleSelection = visibleTargetSelection(groups, selection);
  useEffect(() => { if (selection !== visibleSelection) setSelection(visibleSelection); }, [selection, visibleSelection]);
  const workflowLabel = language === 'ko' ? '워크플로우' : 'Workflow';
  const identifiedJobs = new Map<string, Job[]>();
  for (const job of visibleJobs) {
    if (!job.target) continue;
    const key = job.target.repository.toLowerCase() + '#' + job.target.number;
    const records = identifiedJobs.get(key) ?? [];
    records.push(job);
    identifiedJobs.set(key, records);
  }
  return <div className="repository-list">{repositories.map(repository => {
    const targets = groups.filter(group => (group.target?.repository.toLowerCase() ?? 'unreported') === repository.key);
    if (!targets.length) return null;
    const { counts } = activitySummary(repository.jobs);
    const isCollapsed = collapsed.has(repository.key);
    const contentId = "repository-" + encodeURIComponent(repository.key);
    return <section className="repository-activity" key={repository.key} aria-label={repository.repository ?? t('Unattributed executions')}>
      <div className="repository-heading"><div className="repository-title"><button type="button" className="repository-toggle" aria-label={t(isCollapsed ? "Expand repository" : "Collapse repository") + ": " + (repository.repository ?? t("Unattributed executions"))} aria-expanded={!isCollapsed} aria-controls={contentId} onClick={() => onToggle(repository.key)}><Chevron expanded={!isCollapsed} direction="right"/></button><div><h3>{repository.repository ? <a href={'https://github.com/' + repository.repository} target="_blank" rel="noreferrer">{repository.repository}</a> : t('Unattributed executions')}</h3><small className="muted">{executionCount(language, repository.jobs.length, repository.jobs.length)}</small></div></div>
        <div className="repository-counts"><Badge tone={counts.running ? 'active' : 'neutral'}>{t('Running')} {counts.running}</Badge><Badge tone={counts.queued ? 'warning' : 'neutral'}>{t('Queued')} {counts.queued}</Badge>{counts.failed > 0 && <Badge tone="danger">{t('Recent failures')} {counts.failed}</Badge>}</div></div>
      <Collapsible id={contentId} open={!isCollapsed} className="review-list">{targets.map(group => {
        const target = group.target;
        const selected = target !== undefined && visibleSelection === group.key;
        const targetId = 'target-workflow-' + encodeURIComponent(group.key);
        const records = identifiedJobs.get(group.key) ?? group.jobs;
        const summary = activitySummary(records).counts;
        const latest = records.reduce<Job | undefined>((current, job) => !current || Date.parse(job.updatedAt) > Date.parse(current.updatedAt) ? job : current, undefined);
        const agentList = <ul className="review-agents">{group.jobs.map(job => <ExecutionEntry key={job.role + ':' + job.correlationId + ':' + job.attempt} job={job} language={language} observedAt={observedAt} live={live} agent={renderAgent(job.role)}/>)}</ul>;
        return <Card key={group.key} className="review-group review-target" data-expanded={selected}>
          <div className="review-target-row">
            <div className="review-target-identity"><h3>{target ? <a href={'https://github.com/' + target.repository + '/issues/' + target.number} target="_blank" rel="noreferrer">#{target.number}</a> : t('Target not reported')}</h3><small className="muted">{executionCount(language, records.length, group.total)}{latest && <> · {timestamp(latest.updatedAt, language)}</>}</small></div>
            <div className="review-target-states">{(['running', 'queued', 'failed', 'stale', 'returned', 'skipped', 'published'] as const).map(state => summary[state] > 0 ? <Badge key={state} tone={executionTone(state)}>{executionLabel(language, state)} {summary[state]}</Badge> : null)}</div>
            {target && <button type="button" className="review-target-toggle" aria-expanded={selected} aria-controls={targetId} aria-label={`${workflowLabel} #${target.number}`} onClick={() => setSelection(toggleTargetSelection(visibleSelection, group.key))}><span>{workflowLabel}</span><Chevron expanded={selected}/></button>}
          </div>
          {target ? <Collapsible id={targetId} open={selected}><WorkflowView target={target} visibleJobs={visibleJobs} observedAt={observedAt} language={language} renderAgent={renderAgent}/><details className="execution-details"><summary>{t('Execution details')}</summary>{agentList}</details></Collapsible> : agentList}
        </Card>;
      })}</Collapsible>
    </section>;
  })}</div>;
};
