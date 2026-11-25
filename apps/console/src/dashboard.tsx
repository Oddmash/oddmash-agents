import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Alert, Avatar, Badge, Button, Card, DocsNavigation, EmptyState, Select } from '@oddmash/ui';
import { jobElapsedMs, type Job, type WorkerSettings, type ModelUsageSummary, type AgentRole } from '@oddmash/agent-operator-contract';
import { createStatusPolling } from './status-polling';
import { AgentLoading } from './agent-loading';
import { korean, translate, executionCount, missingCalls, type Language, type Message } from './i18n';
import { activitySummary, filterActivity, groupActivity, jobStates, type ActivityFilter } from './activity';

type Snapshot = { connected: boolean; jobs: Job[]; usage?: (ModelUsageSummary & { role: AgentRole })[]; settings: WorkerSettings | null; settingsUpdatedAt?: string; observedAt: string };
const releaseTag = (import.meta as ImportMeta & { env: { VITE_OPERATOR_RELEASE_TAG?: string } }).env.VITE_OPERATOR_RELEASE_TAG;
const names = { reviewer: 'Lead', impact: 'Impact', triage: 'Triage', qa: 'QA', release: 'Release', docs: 'Docs', architect: 'Architect' };

const icons = {
  reviewer: new URL('../../../assets/agents/lead.svg', import.meta.url).href,
  impact: new URL('../../../assets/agents/impact.svg', import.meta.url).href,
  triage: new URL('../../../assets/agents/triage.svg', import.meta.url).href,
  qa: new URL('../../../assets/agents/qa.svg', import.meta.url).href,
  release: new URL('../../../assets/agents/release.svg', import.meta.url).href,
  docs: new URL('../../../assets/agents/docs.svg', import.meta.url).href,
  architect: new URL('../../../assets/agents/architect.svg', import.meta.url).href,
};
const descriptions: Record<AgentRole, Message> = { reviewer: 'Coordination & code review', impact: 'Product impact', triage: 'Issue triage', qa: 'Quality assurance', release: 'Release notes', docs: 'Documentation', architect: 'Architecture' };
const views = ['overview', 'activity', 'usage', 'settings'] as const;
type View = typeof views[number];
const viewLabels: Record<View, Message> = { overview: 'Review workspace', activity: 'Execution history', usage: 'Model usage', settings: 'Configuration' };
const currentView = (): View => views.find(view => '#' + view === window.location.hash) ?? 'overview';
const AgentIdentity = ({ role, compact = false }: { role: AgentRole; compact?: boolean }) => {
  return <span className={compact ? 'agent-identity compact' : 'agent-identity'}><Avatar src={icons[role]} className="agent-avatar">{names[role].slice(0, 1)}</Avatar><span>{names[role]}</span></span>;
}

function formatElapsed(job: Job, language: Language, observedAt?: string) {
  const elapsed = observedAt ? jobElapsedMs(job, observedAt) : undefined;
  return elapsed === undefined ? '—' : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(Math.round(elapsed / 1000));
}

export const Dashboard = ({ logout, language, languageControl }: { logout: ReactNode; language: Language; languageControl: ReactNode }) => {
  const t = (message: Message) => translate(language, message);
  const [view, setView] = useState<View>(currentView);
  useEffect(() => { const change = () => setView(currentView()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<Message | ''>('');
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const pollingRef = useRef<ReturnType<typeof createStatusPolling> | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>({ role: 'all', state: 'all' });
  useEffect(() => {
    const polling = createStatusPolling({
      hidden: () => document.hidden,
      fetchStatus: async signal => {
        const response = await fetch('/api/status', { cache: 'no-store', signal });
        if (signal.aborted) throw new Error('Status request cancelled');
        if (response.status === 401) {
          setSnapshot(undefined);
          setError('Session expired. Sign in again.');
          return { delayMs: 30000, expired: true };
        }
        if (!response.ok) throw new Error('Status unavailable');
        const data = await response.json() as Snapshot;
        if (signal.aborted) throw new Error('Status request cancelled');
        setSnapshot(data);
        setError('');
        return { delayMs: data.jobs.some(job => job.state === 'running' || job.state === 'queued') ? 10000 : 30000 };
      },
      onError: () => setError('Unable to refresh live status. Try again.'),
      onSettled: () => setLoading(false)
    });
    pollingRef.current = polling;
    document.addEventListener('visibilitychange', polling.visibilityChanged);
    void polling.refresh();
    return () => {
      polling.dispose();
      pollingRef.current = null;
      document.removeEventListener('visibilitychange', polling.visibilityChanged);
    };
  }, []);
  const jobs = snapshot?.jobs ?? [];
  const { counts, byRole } = activitySummary(jobs);
  const visibleJobs = filterActivity(jobs, filter);
  const groups = groupActivity(visibleJobs);
  const displayedGroups = view === 'overview' ? groups.slice(0, 5) : groups;
  const connected = snapshot?.connected === true;
  return <div className="shell">
    <aside><p className="eyebrow">ODDMASH</p><h1>{t("Agents Console")}</h1><p className="muted">{t("Release:")} {typeof releaseTag === 'string' && /^v\d+\.\d+\.\d+$/.test(releaseTag) ? releaseTag : t("Unknown")}</p><DocsNavigation aria-label={t('Console navigation')} currentId={view} groups={[{ id: 'console', items: views.map(item => ({ id: item, href: '#' + item, label: t(viewLabels[item]) })) }]}/><div className="logout">{languageControl}{logout}</div></aside>
    <main>
      <header><div><h2>{t(viewLabels[view])}</h2></div><div className="header-actions"><Button variant="secondary" onClick={() => { pollingRef.current?.setPaused(!paused); setPaused(!paused); }}>{t(paused ? "Resume live updates" : "Pause live updates")}</Button><Button variant="secondary" onClick={() => void pollingRef.current?.refresh()}>{t("Refresh")}</Button></div></header>
      <div role="status" aria-live="polite" className="muted status-line">{loading ? null : error ? <Alert tone="danger">{t(error)}{snapshot?.connected ? t(" Showing the last successful snapshot.") : ''}</Alert> : (snapshot?.connected ? t("Connected to worker telemetry") : t("Telemetry storage is not configured."))}</div>
      {loading && !snapshot && <AgentLoading label={t("Loading status…")}/>}
      <div hidden={!snapshot}>
      <section hidden={view !== 'overview'} className="metrics" aria-label={t("Overview")}>
        <Card><p>{t("Running")}</p><strong>{connected ? counts.running : '—'}</strong></Card>
        <Card><p>{t("Queued")}</p><strong>{connected ? counts.queued : '—'}</strong></Card>
        <Card><p>{t("Stale observations")}</p><strong>{connected ? counts.stale : '—'}</strong></Card>
        <Card><p>{t("Recent failures")}</p><strong>{connected ? counts.failed : '—'}</strong></Card>
        <Card><p>{t("Enabled and configured agents")}</p><strong>{snapshot?.settings ? snapshot.settings.agents.filter(agent => agent.enabled && agent.configured).length : '—'}</strong></Card>
      </section>
      <section hidden={view !== 'overview' && view !== 'activity'} aria-labelledby="review-targets">
        <h2 id="review-targets">{t("Review targets")}</h2>
        <p className="muted">{t("Agents shown are observed executions. Unreported assignments are not inferred; execution completion is not approval.")}</p>
        <div className="activity-filters"><div className="filter-control"><span>{t("Agent")}</span><Select aria-label={t("Agent")} value={filter.role} options={[{ value: 'all', label: t("All agents") }, ...byRole.map(row => ({ value: row.role, label: names[row.role] }))]} onValueChange={value => setFilter(current => ({ ...current, role: value as ActivityFilter['role'] }))}/></div><div className="filter-control"><span>{t("State")}</span><Select aria-label={t("State")} value={filter.state} options={[{ value: 'all', label: t("All states") }, ...jobStates.map(state => ({ value: state, label: t(state) }))]} onValueChange={value => setFilter(current => ({ ...current, state: value as ActivityFilter['state'] }))}/></div><span className="muted">{connected ? executionCount(language, visibleJobs.length, jobs.length) : t("No live activity source")}</span></div>
        <div className="review-list">{displayedGroups.map(group => <Card key={group.key} className="review-group">
          <div className="review-heading"><div><p className="muted">{group.target ? group.target.repository : t("Target not reported")}</p><h3>{group.target ? <a href={'https://github.com/' + group.target.repository + '/issues/' + group.target.number} target="_blank" rel="noreferrer">#{group.target.number}</a> : t("Unattributed executions")}</h3></div><span className="muted">{executionCount(language, group.jobs.length, group.jobs.length)}</span></div>
          <ul className="review-agents">{group.jobs.map(job => <li key={job.role + ':' + job.correlationId + ':' + job.attempt} className="review-agent">
            <div><AgentIdentity role={job.role} compact/><small>{t(descriptions[job.role])}</small></div>
            <div className="review-phase"><strong>{job.phase ? t(job.phase) : t("Not reported")}</strong><small>{t("Attempt")} {job.attempt} · {formatElapsed(job, language, snapshot?.observedAt)}</small></div>
            <div className="review-state"><Badge tone={job.state === 'running' ? 'accent' : 'neutral'}>{t(job.state)}</Badge>{job.failure && <small>{Object.hasOwn(korean, job.failure) ? t(job.failure as Message) : t("unexpected")}</small>}<small><time dateTime={job.updatedAt}>{new Date(job.updatedAt).toLocaleString(language)}</time></small></div>
          </li>)}</ul>
        </Card>)}</div>
        {view === 'overview' && groups.length > 5 && <p><a href="#activity">{t("View all executions")}</a></p>}
        {!groups.length && <Card><EmptyState className="empty">{!connected ? t("Live activity unavailable.") : jobs.length ? t("No executions match these filters.") : t("No recent execution events.")}</EmptyState></Card>}
      </section>
      <section hidden={view !== 'overview'} aria-labelledby="role-overview"><h2 id="role-overview">{t("Agent activity")}</h2><div className="fleet-list">{byRole.map(row => <div key={row.role} className="fleet-row"><AgentIdentity role={row.role} compact/><span className="muted">{t(descriptions[row.role])}</span><Badge tone={connected && row.active > 0 ? 'accent' : 'neutral'}>{connected && row.latest ? t(row.latest.state) : connected ? t('No observed events') : t('Unavailable')}</Badge><span>{t("Active:")} {connected ? row.active : '—'}</span></div>)}</div></section>
      <section hidden={view !== 'usage'} id="usage"><p className="muted">{t("Observed usage in retained terminal executions, including retries. Missing counts and unobserved calls are not zero-cost; these are token counts, not a billing total.")}</p><div className="agent-grid">{snapshot?.usage?.length ? snapshot.usage.map(row => <Card key={row.role}><h3><AgentIdentity role={row.role}/></h3><p>{t("Observed calls:")} {row.calls}</p><p>{t("Known input tokens:")} {row.inputTokens.toLocaleString(language)} · {missingCalls(language, row.missingInput)}</p><p>{t("Known output tokens:")} {row.outputTokens.toLocaleString(language)} · {missingCalls(language, row.missingOutput)}</p></Card>) : <Card><EmptyState className="empty">{t("No measured model usage is retained yet.")}</EmptyState></Card>}</div></section>
      <section hidden={view !== 'settings'} id="settings"><p className="muted">{t("Read-only snapshot of effective worker settings. Credentials are never returned.")} {snapshot?.settingsUpdatedAt && <span>{t("Updated")}: {new Date(snapshot.settingsUpdatedAt).toLocaleString(language)}</span>}</p>
        {snapshot?.settings ? <><div className="metrics"><Card>{t("Queue")} <strong>{snapshot.settings.queueEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Coordinated advisories")} <strong>{snapshot.settings.coordinatedAdvisoriesEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Authenticated guidance")} <strong>{snapshot.settings.authenticatedGuidanceEnabled === undefined ? t("Unknown") : snapshot.settings.authenticatedGuidanceEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Scoped thread resolution")} <strong>{snapshot.settings.scopedThreadResolutionEnabled === undefined ? t("Unknown") : snapshot.settings.scopedThreadResolutionEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Advisory request limit")} <strong>{snapshot.settings.advisoryMaxRequests ?? t("Unknown")}</strong></Card><Card>{t("Advisory time budget")} <strong>{snapshot.settings.advisoryMaxMs === undefined ? t("Unknown") : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(snapshot.settings.advisoryMaxMs / 1000)}</strong></Card></div><div className="agent-grid">{snapshot.settings.agents.map(agent => <Card key={agent.role}><h3><AgentIdentity role={agent.role}/></h3><Badge>{agent.enabled ? t("Enabled") : t("Disabled")}</Badge><p>{t("Model:")} {agent.model ?? t("Unknown")}</p><p>{t("Configuration:")} {agent.configured ? t("Present") : t("Incomplete")}</p><p>{t("Auto-merge:")} {agent.autoMerge ? t("Enabled") : t("Disabled")}</p></Card>)}</div></> : <Card><EmptyState className="empty">{t("No worker configuration snapshot is available.")}</EmptyState></Card>}
      </section>
      {snapshot && <p className="muted">{t("Last observed:")} <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString(language)}</time></p>}
      </div>
    </main></div>;
}
