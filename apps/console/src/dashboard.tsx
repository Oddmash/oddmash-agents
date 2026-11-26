import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { Alert, Avatar, Badge, Button, Card, EmptyState, Select } from '@oddmash/ui';
import { type Job, type WorkerSettings, type ModelUsageSummary, type AgentRole } from '@oddmash/agent-operator-contract';
import { JuliyaText } from '@oddmash/juliya/react';
import { NavigationIcon } from './console-sidebar';
import { ContributorPulls } from './contributor-pulls';
import { AdoptionMetrics } from './adoption-metrics';
import { executionLabel, executionTone } from './execution-status';
import { createStatusPolling } from './status-polling';
import { RuntimeControls } from './runtime-controls';
import { ModelSettings } from './model-settings';
import { ConsoleSkeleton } from './console-skeleton';
import { translate, executionCount, missingCalls, consoleViews, consoleRoute, localizedUrl, type ConsoleView, type Language, type Message } from './i18n';
import { activitySummary, filterActivity, groupActivity, reviewOverview, repositoryActivity, toggleRepositoryCollapse, jobStates, historyNeedsRepository, metricFilter, withRepositoryFilter, activeAdvancedFilters, hasActivityFilters, resetActivityFilters, type ActivityFilter } from './activity';

import { DateRangeFilter } from './date-range-filter';
import { emptyDateRange } from './date-range';
import { Chevron } from './chevron';
import './console-polish.css';
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
const viewLabels: Record<View, Message> = { overview: 'Overview', activity: 'History', contributors: 'Contributor PRs', usage: 'Usage', settings: 'Settings' };
const AgentIdentity = ({ role, compact = false, caption }: { role: AgentRole; compact?: boolean; caption?: ReactNode }) => {
  return <span className={compact ? 'agent-identity compact' : 'agent-identity'}><Avatar src={icons[role]} className="agent-avatar">{names[role].slice(0, 1)}</Avatar><span>{names[role]}{caption && <small className="muted">{caption}</small>}</span></span>;
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
    if (url.origin !== window.location.origin || !/^\/(?:en|ko)(?:\/(?:activity|contributors|usage|settings))?$/.test(url.pathname)) return;
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const advancedToggle = useRef<HTMLButtonElement>(null);
  const resetFilters = () => { setFilter(current => resetActivityFilters(current, view === 'activity')); advancedToggle.current?.focus(); };
  const [selectedTarget, setSelectedTarget] = useState<string>();
  const openMetric = (state: ActivityFilter['state']) => { setSelectedTarget(undefined); setFilter(metricFilter(state)); navigate('activity'); };
  const openTarget = (key: string, repository: string) => { setSelectedTarget(key); setFilter({role:'all',state:'all',repository}); setCollapsedRepositories(previous=>{const next=new Set(previous);next.delete(repository);return next;}); navigate('activity'); };
  const openRepository = (repository: string) => { setSelectedTarget(undefined); setCollapsedRepositories(previous => { const next = new Set(previous); next.delete(repository); return next; }); setFilter(current => withRepositoryFilter(current, repository)); };
  const changeRepository = () => { setSelectedTarget(undefined); setFilter(current => withRepositoryFilter(current)); headingRef.current?.focus(); };
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
  const overview = reviewOverview(groupActivity(jobs));
  const choosingRepository = historyNeedsRepository(view, filter);
  const selectedRepositoryName = filter.repository === 'unreported' ? t('Unattributed executions') : repositories.find(repository => repository.key === filter.repository)?.repository ?? filter.repository;
  const matchedRepositories = repositoryActivity(visibleJobs);
  const displayedGroups = choosingRepository ? [] : groups.map(group => ({ ...group, total: group.jobs.length }));
  const connected = snapshot?.connected === true;
  const advancedCount = activeAdvancedFilters(filter);
  const filtered = hasActivityFilters(filter, false);
  return <div className="shell" onClick={follow}>
    <aside><a className="console-brand" href={href("overview")} aria-label={t("Agents Console")}><img src={brandLogo} width={38} height={38} alt=""/><span>oddmash<span className="brand-dot">.</span></span></a><p className="muted">{t("Release:")} {typeof releaseTag === 'string' && /^v\d+\.\d+\.\d+$/.test(releaseTag) ? releaseTag : t("Unknown")}</p><nav className="console-nav" aria-label={t('Console navigation')}><ul>{views.map(item => <li key={item}><a href={href(item)} aria-current={item === view ? 'page' : undefined}><NavigationIcon view={item}/><span>{t(viewLabels[item])}</span></a></li>)}</ul></nav><div className="logout">{themeControl}{languageControl}{logout}</div></aside>
    <main>
      <header><div><h2 ref={headingRef} tabIndex={-1}>{t(viewLabels[view])}</h2></div><span role="status" aria-live="polite" className="live-label" data-connected={connected && !error}>{!error && <><span className="status-dot" aria-hidden="true"/>{t(loading && !snapshot ? 'Loading status…' : connected ? 'Connected to worker telemetry' : 'Telemetry storage is not configured.')}</>}</span></header>
      <div role="status" aria-live="polite" className="muted status-line">{error && <Alert tone="danger">{t(error)}{snapshot?.connected ? t(" Showing the last successful snapshot.") : ''}</Alert>}</div>
      {loading && !snapshot && view !== 'settings' && view !== 'contributors' && <ConsoleSkeleton view={view} language={language}/>}
      {view === 'usage' && error !== 'Session expired. Sign in again.' && <AdoptionMetrics language={language}/>}
      <div hidden={!snapshot && (view !== 'settings' || error === 'Session expired. Sign in again.')}>
      {view === 'overview' && <div className="overview-content">
        <section className="metrics overview-metrics" aria-label={t('Overview')}>
          {([['running','Running'],['queued','Queued'],['failed','Recent failures'],['stale','Stale observations']] as const).map(([state,label])=><button key={state} type="button" className="metric-link" data-metric={state} data-active={state==='running'&&connected&&counts.running>0&&!error} onClick={()=>openMetric(state)}><span className="metric-label"><span className="metric-mark" aria-hidden="true"/>{t(label)}</span><strong>{connected?counts[state]:'—'}</strong><Chevron direction="right"/></button>)}
        </section>
        <div className="overview-heading"><h2>{t('Recent review targets')}</h2><a href={href('activity')}>{t('View history')} <Chevron direction="right"/></a></div>
        {overview.groups.length ? <div className="overview-targets">{overview.groups.map(group=>{
          const target=group.target!;
          const records=jobs.filter(job=>job.target?.repository.toLowerCase()===target.repository.toLowerCase()&&job.target.number===target.number);
          const summary=activitySummary(records).counts;
          return <button type="button" className="overview-target" key={group.key} onClick={()=>openTarget(group.key,target.repository.toLowerCase())}><span className="overview-target-name"><strong>{target.repository} <span>#{target.number}</span></strong><small className="muted">{executionCount(language,group.total,group.total)}</small></span><span className="overview-target-states">{(['running','queued','failed','stale','returned','published','skipped'] as const).filter(state=>summary[state]>0).slice(0,3).map(state=><Badge key={state} tone={executionTone(state)}>{executionLabel(language,state)} {summary[state]}</Badge>)}</span><Chevron direction="right"/></button>;
        })}</div> : <Card><EmptyState>{connected?t('No recent execution events.'):t('Live activity unavailable.')}</EmptyState></Card>}
        {overview.unattributedCount>0 && <p className="muted">{t('Target not reported')}: {overview.unattributedCount.toLocaleString(language)}</p>}
        <div className="overview-fleet"><span>{t('Ready agents')}</span><strong>{snapshot?.settings?snapshot.settings.agents.filter(agent=>agent.enabled&&agent.configured).length:'—'}</strong><a href={href('settings')}>{t('Settings')} <Chevron direction="right"/></a></div>
      </div>}
      {view === 'activity' && <div className="workspace-history">
      <section aria-labelledby="review-targets">
        <div className="activity-heading"><h2 id="review-targets">{t(choosingRepository ? 'Choose a repository' : 'Review targets')}</h2><span className="muted activity-count" aria-live="polite">{connected ? executionCount(language, visibleJobs.length, jobs.length) : t('No live activity source')}</span></div>
        {!choosingRepository && <div className="history-repository-scope"><span><span className="muted">{t('Repository')}: </span><strong>{selectedRepositoryName}</strong></span><Button type="button" variant="secondary" onClick={changeRepository}>{t('Change repository')}</Button></div>}
        <div className="activity-filters primary-filters"><DateRangeFilter language={language} timeZone={timeZone} value={filter.range ?? emptyDateRange()} onApply={range => setFilter(current => ({ ...current, day: undefined, range }))}/><button type="button" className="advanced-toggle" ref={advancedToggle} aria-expanded={showAdvanced} aria-controls="advanced-filters" onClick={() => setShowAdvanced(value => !value)}>{t('More filters')}{advancedCount > 0 && <Badge tone="active">{advancedCount}</Badge>}<Chevron expanded={showAdvanced}/></button></div>
        <div id="advanced-filters" hidden={!showAdvanced} className="activity-filters advanced-filter-controls"><div className="filter-control"><span>{t("Agent")}</span><Select aria-label={t("Agent")} value={filter.role} options={[{ value: 'all', label: t("All agents") }, ...byRole.map(row => ({ value: row.role, label: names[row.role] }))]} onValueChange={value => setFilter(current => ({ ...current, role: value as ActivityFilter['role'] }))}/></div><div className="filter-control"><span>{t("State")}</span><Select aria-label={t("State")} value={filter.state} options={[{ value: 'all', label: t("All states") }, ...jobStates.map(state => ({ value: state, label: executionLabel(language, state) }))]} onValueChange={value => setFilter(current => ({ ...current, state: value as ActivityFilter['state'] }))}/></div></div>
        {filtered && <div className="applied-filters" role="group" aria-label={t('Applied filters')}>
          {(filter.range?.from || filter.range?.to || (filter.day && filter.day !== 'all')) && <button type="button" className="filter-chip" aria-label={`${t('Remove filter')}: ${t('Date range')}`} onClick={() => { setFilter(current => ({ ...current, day: undefined, range: emptyDateRange() })); advancedToggle.current?.focus(); }}>{t('Date range')}: {filter.range?.from ? filter.range.from.replace('T', ' ') : ''}{filter.range?.from && filter.range?.to ? ' / ' : ''}{filter.range?.to ? filter.range.to.replace('T', ' ') : ''}{!filter.range?.from && !filter.range?.to ? filter.day : ''} <span aria-hidden="true">×</span></button>}
          {filter.role !== 'all' && <button type="button" className="filter-chip" aria-label={`${t('Remove filter')}: ${t('Agent')} ${names[filter.role]}`} onClick={() => { setFilter(current => ({ ...current, role: 'all' })); advancedToggle.current?.focus(); }}>{t('Agent')}: {names[filter.role]} <span aria-hidden="true">×</span></button>}
          {filter.state !== 'all' && <button type="button" className="filter-chip" aria-label={`${t('Remove filter')}: ${t('State')} ${executionLabel(language, filter.state)}`} onClick={() => { setFilter(current => ({ ...current, state: 'all' })); advancedToggle.current?.focus(); }}>{t('State')}: {executionLabel(language, filter.state)} <span aria-hidden="true">×</span></button>}
          <button type="button" className="reset-filters" onClick={resetFilters}>{t('Reset filters')}</button>
        </div>}
        <details className="activity-scope"><summary><span>{t('Observed executions · Completion is not approval')}</span><Chevron disclosure/></summary><JuliyaText as="p" locale={language} className="muted workspace-copy">{t("Observed executions only; unreported assignments and skips are not inferred. Completion is not approval.")}</JuliyaText><p className="muted filter-meta">{t('Local time zone')}: {timeZone} · {t('Retention: up to 7 days or 500 recent events')}</p></details>
        {choosingRepository && <div className="repository-chooser"><ul>{matchedRepositories.map(repository => <li key={repository.key}><button type="button" onClick={() => { openRepository(repository.key); headingRef.current?.focus(); }}><div><strong>{repository.repository ?? t('Unattributed executions')}</strong><span className="muted">{executionCount(language, repository.jobs.length, repository.jobs.length)}</span></div><span className="repository-chooser-state">{repository.active > 0 && <Badge tone="active">{t('Active:')} {repository.active}</Badge>}{repository.failed > 0 && <Badge tone="danger">{t('Recent failures')} {repository.failed}</Badge>}<Chevron direction="right"/></span></button></li>)}</ul></div>}
        {!choosingRepository && snapshot && <RepositoryActivity key={selectedTarget ?? filter.repository ?? 'all'} initialSelection={selectedTarget} collapsed={collapsedRepositories} onToggle={toggleRepository} groups={displayedGroups} visibleJobs={visibleJobs} observedAt={snapshot.observedAt} live={connected && !error} language={language} renderAgent={role => <><AgentIdentity role={role} compact/><small>{t(descriptions[role])}</small></>}/>}
        {(choosingRepository ? !matchedRepositories.length : !displayedGroups.length) && <Card><EmptyState className="empty">{!connected ? t("Live activity unavailable.") : jobs.length ? t("No executions match these filters.") : t("No recent execution events.")}</EmptyState></Card>}
      </section>
      </div>}
      <section hidden={view !== 'usage'} id="usage" className="detail-view">
        <h2>{t("Model usage")}</h2>
        <JuliyaText as="p" locale={language} className="muted view-description">{t("Observed usage in retained terminal executions, including retries. Missing counts and unobserved calls are not zero-cost; these are token counts, not a billing total.")}</JuliyaText>
        {snapshot?.usage?.length ? <Card className="data-panel"><div aria-hidden="true" className="data-heading usage-grid"><span>{t("Agent")}</span><span>{t("Observed calls:")}</span><span>{t("Known input tokens:")}</span><span>{t("Known output tokens:")}</span></div><ul className="data-rows">{snapshot.usage.map(row => <li key={row.role} className="usage-grid data-row"><AgentIdentity role={row.role}/><div><small className="field-label">{t("Observed calls:")}</small><strong>{row.calls.toLocaleString(language)}</strong></div><div><small className="field-label">{t("Known input tokens:")}</small><strong>{row.inputTokens.toLocaleString(language)}</strong><small className="muted">{missingCalls(language, row.missingInput)}</small></div><div><small className="field-label">{t("Known output tokens:")}</small><strong>{row.outputTokens.toLocaleString(language)}</strong><small className="muted">{missingCalls(language, row.missingOutput)}</small></div></li>)}</ul></Card> : <Card><EmptyState className="empty">{t("No measured model usage is retained yet.")}</EmptyState></Card>}
      </section>
      <section hidden={view !== 'settings'} id="settings" className="detail-view">
        {error !== 'Session expired. Sign in again.' && <ModelSettings language={language} agents={snapshot?.settings?.agents} updatedAt={snapshot?.settingsUpdatedAt} renderAgent={role => <AgentIdentity role={role} caption={t(descriptions[role])}/>}/>}
        {snapshot && <RuntimeControls language={language} defaults={{ maxRequests: snapshot.settings?.advisoryMaxRequests, maxMs: snapshot.settings?.advisoryMaxMs }}/>}
        <div className="detail-intro"><JuliyaText as="p" locale={language} className="muted view-description">{t("Read-only snapshot of effective worker settings. Credentials are never returned.")}</JuliyaText>{snapshot?.settingsUpdatedAt && <small className="muted">{t("Updated")}: {new Date(snapshot.settingsUpdatedAt).toLocaleString(language)}</small>}</div>
        {snapshot?.settings ? <div className="settings-panels"><Card className="settings-panel"><h3>{t("Execution")}</h3><dl><div><dt>{t("Queue")}</dt><dd><StatusValue value={snapshot.settings.queueEnabled} language={language}/></dd></div><div><dt>{t("Coordinated advisories")}</dt><dd><StatusValue value={snapshot.settings.coordinatedAdvisoriesEnabled} language={language}/></dd></div><div><dt>{t("Authenticated guidance")}</dt><dd><StatusValue value={snapshot.settings.authenticatedGuidanceEnabled} language={language}/></dd></div><div><dt>{t("Scoped thread resolution")}</dt><dd><StatusValue value={snapshot.settings.scopedThreadResolutionEnabled} language={language}/></dd></div></dl></Card><Card className="settings-panel"><h3>{t("Review limits")}</h3><dl><div><dt>{t("Advisory request limit")}</dt><dd>{snapshot.settings.advisoryMaxRequests ?? t("Unknown")}</dd></div><div><dt>{t("Advisory time budget")}</dt><dd>{snapshot.settings.advisoryMaxMs === undefined ? t("Unknown") : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(snapshot.settings.advisoryMaxMs / 1000)}</dd></div></dl></Card></div> : <Card><EmptyState className="empty">{t("No worker configuration snapshot is available.")}</EmptyState></Card>}
      </section>
      {snapshot && view !== 'contributors' && <p className="muted">{t("Last observed:")} <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString(language)}</time></p>}
      </div>
      {view === 'contributors' && error !== 'Session expired. Sign in again.' && <ContributorPulls language={language} jobs={jobs} renderAgent={role => <AgentIdentity role={role} compact/>}/>}

    </main></div>;
}
