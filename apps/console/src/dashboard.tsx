import { useEffect, useState, type ReactNode, type MouseEvent } from 'react';
import { Alert, Avatar, Badge, Card, DocsNavigation, EmptyState, Select } from '@oddmash/ui';
import { type Job, type WorkerSettings, type ModelUsageSummary, type AgentRole } from '@oddmash/agent-operator-contract';
import { createStatusPolling } from './status-polling';
import { RuntimeControls } from './runtime-controls';
import { ConsoleSkeleton } from './console-skeleton';
import { translate, executionCount, missingCalls, consoleViews, consoleRoute, localizedUrl, type ConsoleView, type Language, type Message } from './i18n';
import { activitySummary, filterActivity, groupActivity, reviewOverview, repositoryActivity, toggleRepositoryCollapse, activityDays, jobStates, type ActivityFilter } from './activity';

import { RepositoryActivity } from './repository-activity';

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
const brandLogo = '/oddmash-logo.png';
const descriptions: Record<AgentRole, Message> = { reviewer: 'Coordination & code review', impact: 'Product impact', triage: 'Issue triage', qa: 'Quality assurance', release: 'Release notes', docs: 'Documentation', architect: 'Architecture' };
const views = consoleViews;
type View = ConsoleView;
const viewLabels: Record<View, Message> = { overview: 'Review workspace', activity: 'Execution history', usage: 'Model usage', settings: 'Configuration' };
const AgentIdentity = ({ role, compact = false }: { role: AgentRole; compact?: boolean }) => {
  return <span className={compact ? 'agent-identity compact' : 'agent-identity'}><Avatar src={icons[role]} className="agent-avatar">{names[role].slice(0, 1)}</Avatar><span>{names[role]}</span></span>;
}

const StatusValue = ({ value, language, yes = 'Enabled', no = 'Disabled' }: { value: boolean | undefined; language: Language; yes?: Message; no?: Message }) => <span className="status-value" data-state={value === undefined ? 'unknown' : value ? 'on' : 'off'}><span aria-hidden="true" className="status-dot"/>{translate(language, value === undefined ? 'Unknown' : value ? yes : no)}</span>;

export const Dashboard = ({ logout, language, languageControl, view, navigate }: { logout: ReactNode; language: Language; languageControl: ReactNode; view: ConsoleView; navigate: (view: ConsoleView) => void }) => {
  const t = (message: Message) => translate(language, message);
  const href = (next: ConsoleView) => localizedUrl(window.location.href, language, next).href;
  const follow = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin || !/^\/(?:en|ko)(?:\/(?:activity|usage|settings))?$/.test(url.pathname)) return;
    const next = consoleRoute(url.href);
    if (next.language !== language) return;
    event.preventDefault();
    navigate(next.view);
  };
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<Message | ''>('');
  const [loading, setLoading] = useState(true);
  const [collapsedRepositories, setCollapsedRepositories] = useState<Set<string>>(() => new Set());
  const toggleRepository = (key: string) => setCollapsedRepositories(previous => toggleRepositoryCollapse(previous, key));
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
      onError: () => setError('Unable to refresh live status. Retrying automatically.'),
      onSettled: () => setLoading(false)
    });
    document.addEventListener('visibilitychange', polling.visibilityChanged);
    void polling.refresh();
    return () => {
      polling.dispose();
      document.removeEventListener('visibilitychange', polling.visibilityChanged);
    };
  }, []);
  const jobs = snapshot?.jobs ?? [];
  const repositories = repositoryActivity(jobs);
  const days = activityDays(jobs);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { counts, byRole } = activitySummary(jobs);
  const visibleJobs = filterActivity(jobs, filter);
  const groups = groupActivity(visibleJobs);
  const overview = reviewOverview(groups);
  const displayedGroups = view === 'overview' ? overview.groups : groups.map(group => ({ ...group, total: group.jobs.length }));
  const connected = snapshot?.connected === true;
  return <div className="shell" onClick={follow}>
    <aside><a className="console-brand" href={href("overview")} aria-label={t("Agents Console")}><img src={brandLogo} width={38} height={38} alt=""/><span>oddmash<span className="brand-dot">.</span></span></a><p className="muted">{t("Release:")} {typeof releaseTag === 'string' && /^v\d+\.\d+\.\d+$/.test(releaseTag) ? releaseTag : t("Unknown")}</p><DocsNavigation aria-label={t('Console navigation')} currentId={view} groups={[{ id: 'console', items: views.map(item => ({ id: item, href: href(item), label: t(viewLabels[item]) })) }]}/><div className="logout">{languageControl}{logout}</div></aside>
    <main>
      <header><div><h2>{t(viewLabels[view])}</h2></div><span className="live-label"><span className="status-dot" aria-hidden="true"/>{t('Automatic updates')}</span></header>
      <div role="status" aria-live="polite" className="muted status-line">{loading ? null : error ? <Alert tone="danger">{t(error)}{snapshot?.connected ? t(" Showing the last successful snapshot.") : ''}</Alert> : (snapshot?.connected ? t("Connected to worker telemetry") : t("Telemetry storage is not configured."))}</div>
      {loading && !snapshot && <ConsoleSkeleton view={view} language={language}/>}
      <div hidden={!snapshot}>
      <section hidden={view !== 'overview'} className="metrics overview-metrics" aria-label={t("Overview")}>
        <div><p>{t("Running")}</p><strong>{connected ? counts.running : '—'}</strong></div>
        <div><p>{t("Queued")}</p><strong>{connected ? counts.queued : '—'}</strong></div>
        <div><p>{t("Stale observations")}</p><strong>{connected ? counts.stale : '—'}</strong></div>
        <div><p>{t("Recent failures")}</p><strong>{connected ? counts.failed : '—'}</strong></div>
        <div><p>{t("Enabled and configured agents")}</p><strong>{snapshot?.settings ? snapshot.settings.agents.filter(agent => agent.enabled && agent.configured).length : '—'}</strong></div>
      </section>
      <div className={view === 'overview' ? "workspace-columns" : "workspace-history"} hidden={view !== 'overview' && view !== 'activity'}>
      <section aria-labelledby="review-targets">
        <h2 id="review-targets">{t("Review targets")}</h2>
        <p className="muted">{t("Agents shown are observed executions. Unreported assignments are not inferred; execution completion is not approval.")}</p>
        <div className="activity-filters"><div className="filter-control project-filter"><span>{t("Repository")}</span><Select aria-label={t("Repository")} value={filter.repository ?? "all"} options={[{ value: "all", label: t("All repositories") }, ...repositories.map(repository => ({ value: repository.key, label: (repository.repository ?? t("Target not reported")) + " (" + repository.jobs.length + ")" }))]} onValueChange={value => setFilter(current => ({ ...current, repository: value }))}/></div><div className="filter-control"><span>{t('Activity day')}</span><Select aria-label={t('Activity day')} value={filter.day ?? 'all'} options={[{ value: 'all', label: t('All days') }, ...days.map(day => ({ value: day, label: day }))]} onValueChange={value => setFilter(current => ({ ...current, day: value }))}/></div><div className="filter-control"><span>{t("Agent")}</span><Select aria-label={t("Agent")} value={filter.role} options={[{ value: 'all', label: t("All agents") }, ...byRole.map(row => ({ value: row.role, label: names[row.role] }))]} onValueChange={value => setFilter(current => ({ ...current, role: value as ActivityFilter['role'] }))}/></div><div className="filter-control"><span>{t("State")}</span><Select aria-label={t("State")} value={filter.state} options={[{ value: 'all', label: t("All states") }, ...jobStates.map(state => ({ value: state, label: t(state) }))]} onValueChange={value => setFilter(current => ({ ...current, state: value as ActivityFilter['state'] }))}/></div><span className="muted">{connected ? executionCount(language, visibleJobs.length, jobs.length) : t("No live activity source")}</span></div>
        <p className="muted">{t('Local time zone')}: {timeZone} · {t('Retained observations (up to 7 days or 500 recent events)')}</p>
        {(view === 'overview' || view === 'activity') && snapshot && <RepositoryActivity collapsed={collapsedRepositories} onToggle={toggleRepository} groups={displayedGroups} visibleJobs={visibleJobs} observedAt={snapshot.observedAt} live={connected && !error} language={language} renderAgent={role => <><AgentIdentity role={role} compact/><small>{t(descriptions[role])}</small></>}/>}
        {view === 'overview' && (overview.identifiedCount > 5 || overview.unattributedCount > 0 || overview.groups.some(group => group.total > group.jobs.length)) && <div className="history-summary">{overview.unattributedCount > 0 && <span className="muted">{t("Target not reported")}: {overview.unattributedCount.toLocaleString(language)}</span>}<a href={href("activity")}>{t("View all executions")}</a></div>}
        {!displayedGroups.length && <Card><EmptyState className="empty">{!connected ? t("Live activity unavailable.") : view === 'overview' && overview.unattributedCount > 0 ? t("No identified review targets.") : jobs.length ? t("No executions match these filters.") : t("No recent execution events.")}</EmptyState></Card>}
      </section>
      <section hidden={view !== 'overview'} className="fleet-panel" aria-labelledby="role-overview"><h2 id="role-overview">{t("Agent activity")}</h2><div className="fleet-list">{byRole.map(row => <div key={row.role} className="fleet-row"><div><AgentIdentity role={row.role} compact/><small className="muted">{t(descriptions[row.role])}</small></div><div className="fleet-state"><Badge tone={connected && row.active > 0 ? 'accent' : 'neutral'}>{connected && row.latest ? t(row.latest.state) : connected ? t('No observed events') : t('Unavailable')}</Badge><small className="muted">{t("Active:")} {connected ? row.active : '—'}</small></div></div>)}</div></section>
      </div>
      <section hidden={view !== 'usage'} id="usage" className="detail-view">
        <p className="muted view-description">{t("Observed usage in retained terminal executions, including retries. Missing counts and unobserved calls are not zero-cost; these are token counts, not a billing total.")}</p>
        {snapshot?.usage?.length ? <Card className="data-panel"><div aria-hidden="true" className="data-heading usage-grid"><span>{t("Agent")}</span><span>{t("Observed calls:")}</span><span>{t("Known input tokens:")}</span><span>{t("Known output tokens:")}</span></div><ul className="data-rows">{snapshot.usage.map(row => <li key={row.role} className="usage-grid data-row"><AgentIdentity role={row.role}/><div><small className="field-label">{t("Observed calls:")}</small><strong>{row.calls.toLocaleString(language)}</strong></div><div><small className="field-label">{t("Known input tokens:")}</small><strong>{row.inputTokens.toLocaleString(language)}</strong><small className="muted">{missingCalls(language, row.missingInput)}</small></div><div><small className="field-label">{t("Known output tokens:")}</small><strong>{row.outputTokens.toLocaleString(language)}</strong><small className="muted">{missingCalls(language, row.missingOutput)}</small></div></li>)}</ul></Card> : <Card><EmptyState className="empty">{t("No measured model usage is retained yet.")}</EmptyState></Card>}
      </section>
      <section hidden={view !== 'settings'} id="settings" className="detail-view">
        {snapshot && <RuntimeControls language={language} defaults={{ maxRequests: snapshot.settings?.advisoryMaxRequests, maxMs: snapshot.settings?.advisoryMaxMs }}/>}
        <div className="detail-intro"><p className="muted view-description">{t("Read-only snapshot of effective worker settings. Credentials are never returned.")}</p>{snapshot?.settingsUpdatedAt && <small className="muted">{t("Updated")}: {new Date(snapshot.settingsUpdatedAt).toLocaleString(language)}</small>}</div>
        {snapshot?.settings ? <><div className="settings-panels"><Card className="settings-panel"><h3>{t("Execution")}</h3><dl><div><dt>{t("Queue")}</dt><dd><StatusValue value={snapshot.settings.queueEnabled} language={language}/></dd></div><div><dt>{t("Coordinated advisories")}</dt><dd><StatusValue value={snapshot.settings.coordinatedAdvisoriesEnabled} language={language}/></dd></div><div><dt>{t("Authenticated guidance")}</dt><dd><StatusValue value={snapshot.settings.authenticatedGuidanceEnabled} language={language}/></dd></div><div><dt>{t("Scoped thread resolution")}</dt><dd><StatusValue value={snapshot.settings.scopedThreadResolutionEnabled} language={language}/></dd></div></dl></Card><Card className="settings-panel"><h3>{t("Review limits")}</h3><dl><div><dt>{t("Advisory request limit")}</dt><dd>{snapshot.settings.advisoryMaxRequests ?? t("Unknown")}</dd></div><div><dt>{t("Advisory time budget")}</dt><dd>{snapshot.settings.advisoryMaxMs === undefined ? t("Unknown") : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(snapshot.settings.advisoryMaxMs / 1000)}</dd></div></dl></Card></div>
        <div className="section-heading"><h2>{t("Agent configuration")}</h2><span className="muted">{snapshot.settings.agents.filter(agent => agent.enabled && agent.configured).length} / {snapshot.settings.agents.length} {t("Ready")}</span></div>
        <Card className="data-panel"><div aria-hidden="true" className="data-heading config-grid"><span>{t("Agent")}</span><span>{t("State")}</span><span>{t("Model:")}</span><span>{t("Configuration")}</span><span>{t("Auto-merge:")}</span></div><ul className="data-rows">{snapshot.settings.agents.map(agent => <li key={agent.role} className="config-grid data-row"><div><AgentIdentity role={agent.role}/><small className="muted role-caption">{t(descriptions[agent.role])}</small></div><div><small className="field-label">{t("State")}</small><StatusValue value={agent.enabled} language={language}/></div><div><small className="field-label">{t("Model:")}</small><code>{agent.model ?? t("Unknown")}</code></div><div><small className="field-label">{t("Configuration")}</small><StatusValue value={agent.configured} language={language} yes="Present" no="Incomplete"/></div><div><small className="field-label">{t("Auto-merge:")}</small><StatusValue value={agent.autoMerge} language={language}/></div></li>)}</ul></Card></> : <Card><EmptyState className="empty">{t("No worker configuration snapshot is available.")}</EmptyState></Card>}
      </section>
      {snapshot && <p className="muted">{t("Last observed:")} <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString(language)}</time></p>}
      </div>
    </main></div>;
}
