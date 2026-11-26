import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { Alert, Avatar, Badge, Card, EmptyState, Select } from '@oddmash/ui';
import { type Job, type WorkerSettings, type ModelUsageSummary, type AgentRole } from '@oddmash/agent-operator-contract';
import { JuliyaText } from '@oddmash/juliya/react';
import { NavigationIcon } from './console-sidebar';
import { executionLabel, executionTone } from './execution-status';
import { createStatusPolling } from './status-polling';
import { RuntimeControls } from './runtime-controls';
import { ConsoleSkeleton } from './console-skeleton';
import { translate, executionCount, missingCalls, consoleViews, consoleRoute, localizedUrl, type ConsoleView, type Language, type Message } from './i18n';
import { activitySummary, filterActivity, groupActivity, reviewOverview, repositoryActivity, toggleRepositoryCollapse, jobStates, historyNeedsRepository, metricFilter, type ActivityFilter } from './activity';

import { DateRangeFilter } from './date-range-filter';
import { emptyDateRange } from './date-range';
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

const StatusValue = ({ value, language, yes = 'Enabled', no = 'Disabled' }: { value: boolean | undefined; language: Language; yes?: Message; no?: Message }) => <Badge className="status-value" tone={value === true ? 'success' : value === false && no === 'Incomplete' ? 'warning' : 'neutral'}>{translate(language, value === undefined ? 'Unknown' : value ? yes : no)}</Badge>;

export const Dashboard = ({ logout, language, languageControl, themeControl, view, navigate }: { logout: ReactNode; language: Language; languageControl: ReactNode; themeControl: ReactNode; view: ConsoleView; navigate: (view: ConsoleView) => void }) => {
  const t = (message: Message) => translate(language, message);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(view);
  useEffect(() => { if (previousView.current !== view) { previousView.current = view; headingRef.current?.focus(); } }, [view]);
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
  const openMetric = (state: ActivityFilter['state']) => { setFilter(metricFilter(state)); navigate('activity'); };
  const openRepository = (repository: string) => { setCollapsedRepositories(previous => { const next = new Set(previous); next.delete(repository); return next; }); setFilter(current => ({ ...current, repository })); };
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
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { counts, byRole } = activitySummary(jobs);
  const visibleJobs = filterActivity(jobs, filter);
  const groups = groupActivity(visibleJobs);
  const overview = reviewOverview(groups);
  const choosingRepository = historyNeedsRepository(view, filter);
  const matchedRepositories = repositoryActivity(visibleJobs);
  const displayedGroups = view === 'overview' ? overview.groups : choosingRepository ? [] : groups.map(group => ({ ...group, total: group.jobs.length }));
  const connected = snapshot?.connected === true;
  return <div className="shell" onClick={follow}>
    <aside><a className="console-brand" href={href("overview")} aria-label={t("Agents Console")}><img src={brandLogo} width={38} height={38} alt=""/><span>oddmash<span className="brand-dot">.</span></span></a><p className="muted">{t("Release:")} {typeof releaseTag === 'string' && /^v\d+\.\d+\.\d+$/.test(releaseTag) ? releaseTag : t("Unknown")}</p><nav className="console-nav" aria-label={t('Console navigation')}><ul>{views.map(item => <li key={item}><a href={href(item)} aria-current={item === view ? 'page' : undefined}><NavigationIcon view={item}/><span>{t(viewLabels[item])}</span></a></li>)}</ul></nav><div className="logout">{themeControl}{languageControl}{logout}</div></aside>
    <main>
      <header><div><h2 ref={headingRef} tabIndex={-1}>{t(viewLabels[view])}</h2></div><span className="live-label"><span className="status-dot" aria-hidden="true"/>{t('Automatic updates')}</span></header>
      <div role="status" aria-live="polite" className="muted status-line">{loading ? null : error ? <Alert tone="danger">{t(error)}{snapshot?.connected ? t(" Showing the last successful snapshot.") : ''}</Alert> : (snapshot?.connected ? t("Connected to worker telemetry") : t("Telemetry storage is not configured."))}</div>
      {loading && !snapshot && <ConsoleSkeleton view={view} language={language}/>}
      <div hidden={!snapshot}>
      <section hidden={view !== 'overview'} className="metrics overview-metrics" aria-label={t("Overview")}>
        {([
          ['running', 'Running'], ['queued', 'Queued'], ['stale', 'Stale observations'], ['failed', 'Recent failures']
        ] as const).map(([state, label]) => <button key={state} type="button" className="metric-link" onClick={() => openMetric(state)}><span>{t(label)}</span><strong>{connected ? counts[state] : '—'}</strong></button>)}
        <a className="metric-link" href={href('settings')}><span>{t("Enabled and configured agents")}</span><strong>{snapshot?.settings ? snapshot.settings.agents.filter(agent => agent.enabled && agent.configured).length : '—'}</strong></a>
      </section>
      <div className={view === 'overview' ? "workspace-columns" : "workspace-history"} hidden={view !== 'overview' && view !== 'activity'}>
      <section aria-labelledby="review-targets">
        <h2 id="review-targets">{t("Review targets")}</h2>
        <JuliyaText as="p" locale={language} className="muted">{t("Agents shown are observed executions. Unreported assignments are not inferred; execution completion is not approval.")}</JuliyaText>
        <div className="activity-filters"><div className="filter-control project-filter"><span>{t("Repository")}</span><Select aria-label={t("Repository")} value={filter.repository ?? "all"} options={[{ value: "all", label: t(view === 'activity' ? "Choose a repository" : "All repositories") }, ...repositories.map(repository => ({ value: repository.key, label: (repository.repository ?? t("Target not reported")) + " (" + repository.jobs.length + ")" }))]} onValueChange={openRepository}/></div><DateRangeFilter language={language} timeZone={timeZone} value={filter.range ?? emptyDateRange()} onApply={range => setFilter(current => ({ ...current, day: undefined, range }))}/><div className="filter-control"><span>{t("Agent")}</span><Select aria-label={t("Agent")} value={filter.role} options={[{ value: 'all', label: t("All agents") }, ...byRole.map(row => ({ value: row.role, label: names[row.role] }))]} onValueChange={value => setFilter(current => ({ ...current, role: value as ActivityFilter['role'] }))}/></div><div className="filter-control"><span>{t("State")}</span><Select aria-label={t("State")} value={filter.state} options={[{ value: 'all', label: t("All states") }, ...jobStates.map(state => ({ value: state, label: executionLabel(language, state) }))]} onValueChange={value => setFilter(current => ({ ...current, state: value as ActivityFilter['state'] }))}/></div><span className="muted">{connected ? executionCount(language, visibleJobs.length, jobs.length) : t("No live activity source")}</span></div>
        <p className="muted">{t('Local time zone')}: {timeZone} · {t('Retained observations (up to 7 days or 500 recent events)')}</p>
        {choosingRepository && <section className="repository-chooser" aria-labelledby="choose-repository"><h3 id="choose-repository">{t('Choose a repository')}</h3><JuliyaText as="p" locale={language} className="muted">{t('Choose one repository to inspect its matching executions.')}</JuliyaText><ul>{matchedRepositories.map(repository => <li key={repository.key}><button type="button" onClick={() => { openRepository(repository.key); headingRef.current?.focus(); }}><div><strong>{repository.repository ?? t('Unattributed executions')}</strong><span className="muted">{executionCount(language, repository.jobs.length, repository.jobs.length)}</span></div><span className="repository-chooser-state">{repository.active > 0 && <Badge tone="active">{t('Active:')} {repository.active}</Badge>}{repository.failed > 0 && <Badge tone="danger">{t('Recent failures')} {repository.failed}</Badge>}<span aria-hidden="true">›</span></span></button></li>)}</ul></section>}
        {!choosingRepository && (view === 'overview' || view === 'activity') && snapshot && <RepositoryActivity collapsed={collapsedRepositories} onToggle={toggleRepository} groups={displayedGroups} visibleJobs={visibleJobs} observedAt={snapshot.observedAt} live={connected && !error} language={language} renderAgent={role => <><AgentIdentity role={role} compact/><small>{t(descriptions[role])}</small></>}/>}
        {view === 'overview' && (overview.identifiedCount > 5 || overview.unattributedCount > 0 || overview.groups.some(group => group.total > group.jobs.length)) && <div className="history-summary">{overview.unattributedCount > 0 && <span className="muted">{t("Target not reported")}: {overview.unattributedCount.toLocaleString(language)}</span>}<a href={href("activity")}>{t("View all executions")}</a></div>}
        {(choosingRepository ? !matchedRepositories.length : !displayedGroups.length) && <Card><EmptyState className="empty">{!connected ? t("Live activity unavailable.") : view === 'overview' && overview.unattributedCount > 0 ? t("No identified review targets.") : jobs.length ? t("No executions match these filters.") : t("No recent execution events.")}</EmptyState></Card>}
      </section>
      <section hidden={view !== 'overview'} className="fleet-panel" aria-labelledby="role-overview"><h2 id="role-overview">{t("Agent activity")}</h2><div className="fleet-list">{byRole.map(row => <div key={row.role} className="fleet-row"><div><AgentIdentity role={row.role} compact/><small className="muted">{t(descriptions[row.role])}</small></div><div className="fleet-state"><Badge tone={connected && row.latest ? executionTone(row.latest.state) : 'neutral'}>{connected && row.latest ? executionLabel(language, row.latest.state, row.role) : connected ? t('No observed events') : t('Unavailable')}</Badge><small className="muted">{t("Active:")} {connected ? row.active : '—'}</small></div></div>)}</div></section>
      </div>
      <section hidden={view !== 'usage'} id="usage" className="detail-view">
        <JuliyaText as="p" locale={language} className="muted view-description">{t("Observed usage in retained terminal executions, including retries. Missing counts and unobserved calls are not zero-cost; these are token counts, not a billing total.")}</JuliyaText>
        {snapshot?.usage?.length ? <Card className="data-panel"><div aria-hidden="true" className="data-heading usage-grid"><span>{t("Agent")}</span><span>{t("Observed calls:")}</span><span>{t("Known input tokens:")}</span><span>{t("Known output tokens:")}</span></div><ul className="data-rows">{snapshot.usage.map(row => <li key={row.role} className="usage-grid data-row"><AgentIdentity role={row.role}/><div><small className="field-label">{t("Observed calls:")}</small><strong>{row.calls.toLocaleString(language)}</strong></div><div><small className="field-label">{t("Known input tokens:")}</small><strong>{row.inputTokens.toLocaleString(language)}</strong><small className="muted">{missingCalls(language, row.missingInput)}</small></div><div><small className="field-label">{t("Known output tokens:")}</small><strong>{row.outputTokens.toLocaleString(language)}</strong><small className="muted">{missingCalls(language, row.missingOutput)}</small></div></li>)}</ul></Card> : <Card><EmptyState className="empty">{t("No measured model usage is retained yet.")}</EmptyState></Card>}
      </section>
      <section hidden={view !== 'settings'} id="settings" className="detail-view">
        {snapshot && <RuntimeControls language={language} defaults={{ maxRequests: snapshot.settings?.advisoryMaxRequests, maxMs: snapshot.settings?.advisoryMaxMs }}/>}
        <div className="detail-intro"><JuliyaText as="p" locale={language} className="muted view-description">{t("Read-only snapshot of effective worker settings. Credentials are never returned.")}</JuliyaText>{snapshot?.settingsUpdatedAt && <small className="muted">{t("Updated")}: {new Date(snapshot.settingsUpdatedAt).toLocaleString(language)}</small>}</div>
        {snapshot?.settings ? <><div className="settings-panels"><Card className="settings-panel"><h3>{t("Execution")}</h3><dl><div><dt>{t("Queue")}</dt><dd><StatusValue value={snapshot.settings.queueEnabled} language={language}/></dd></div><div><dt>{t("Coordinated advisories")}</dt><dd><StatusValue value={snapshot.settings.coordinatedAdvisoriesEnabled} language={language}/></dd></div><div><dt>{t("Authenticated guidance")}</dt><dd><StatusValue value={snapshot.settings.authenticatedGuidanceEnabled} language={language}/></dd></div><div><dt>{t("Scoped thread resolution")}</dt><dd><StatusValue value={snapshot.settings.scopedThreadResolutionEnabled} language={language}/></dd></div></dl></Card><Card className="settings-panel"><h3>{t("Review limits")}</h3><dl><div><dt>{t("Advisory request limit")}</dt><dd>{snapshot.settings.advisoryMaxRequests ?? t("Unknown")}</dd></div><div><dt>{t("Advisory time budget")}</dt><dd>{snapshot.settings.advisoryMaxMs === undefined ? t("Unknown") : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(snapshot.settings.advisoryMaxMs / 1000)}</dd></div></dl></Card></div>
        <div className="section-heading"><h2>{t("Agent configuration")}</h2><span className="muted">{snapshot.settings.agents.filter(agent => agent.enabled && agent.configured).length} / {snapshot.settings.agents.length} {t("Ready")}</span></div>
        <Card className="data-panel"><div aria-hidden="true" className="data-heading config-grid"><span>{t("Agent")}</span><span>{t("State")}</span><span>{t("Deployment model")}</span><span>{t("Configuration")}</span><span>{t("Auto-merge:")}</span></div><ul className="data-rows">{snapshot.settings.agents.map(agent => <li key={agent.role} className="config-grid data-row"><div><AgentIdentity role={agent.role}/><small className="muted role-caption">{t(descriptions[agent.role])}</small></div><div><small className="field-label">{t("State")}</small><StatusValue value={agent.enabled} language={language}/></div><div><small className="field-label">{t("Deployment model")}</small><code>{agent.model ?? t("Unknown")}</code></div><div><small className="field-label">{t("Configuration")}</small><StatusValue value={agent.configured} language={language} yes="Present" no="Incomplete"/></div><div><small className="field-label">{t("Auto-merge:")}</small><StatusValue value={agent.autoMerge} language={language}/></div></li>)}</ul></Card></> : <Card><EmptyState className="empty">{t("No worker configuration snapshot is available.")}</EmptyState></Card>}
      </section>
      {snapshot && <p className="muted">{t("Last observed:")} <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString(language)}</time></p>}
      </div>
    </main></div>;
}
