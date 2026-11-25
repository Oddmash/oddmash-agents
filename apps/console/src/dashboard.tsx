import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Badge, Button, Card, Select } from '@oddmash/ui';
import { jobElapsedMs, type Job, type WorkerSettings, type ModelUsageSummary, type AgentRole } from '@oddmash/agent-operator-contract';
import { korean, translate, executionCount, missingCalls, type Language, type Message } from './i18n';
import { activitySummary, filterActivity, jobStates, type ActivityFilter } from './activity';

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
const viewLabels: Record<View, Message> = { overview: 'Overview', activity: 'Live activity', usage: 'Model usage', settings: 'Configuration' };
const currentView = (): View => views.find(view => '#' + view === window.location.hash) ?? 'overview';
const AgentIdentity = ({ role, compact = false }: { role: AgentRole; compact?: boolean }) => {
  return <span className={compact ? 'agent-identity compact' : 'agent-identity'}><img src={icons[role]} alt="" width={compact ? 28 : 48} height={compact ? 28 : 48}/><span>{names[role]}</span></span>;
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
  const [filter, setFilter] = useState<ActivityFilter>({ role: 'all', state: 'all' });
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let sessionExpired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    async function refresh() {
      if (disposed || document.hidden || request || sessionExpired) return;
      request = new AbortController();
      let delay = 30000;
      try {
        const response = await fetch('/api/status', { cache: 'no-store', signal: request.signal });
        if (response.status === 401) {
          sessionExpired = true;
          if (!disposed) { setSnapshot(undefined); setError('Session expired. Sign in again.'); }
          return;
        }
        if (!response.ok) throw new Error('Status unavailable');
        const data = await response.json() as Snapshot;
        if (!disposed) { setSnapshot(data); setError(''); }
        if (data.jobs.some(job => job.state === 'running' || job.state === 'queued')) delay = 10000;
      } catch {
        if (!disposed && !document.hidden) setError('Unable to refresh live status. Try again.');
      } finally {
        request = undefined;
        if (!disposed) setLoading(false);
        if (!disposed && !document.hidden && !sessionExpired) timer = setTimeout(refresh, delay);
      }
    }
    function wake() {
      if (timer) clearTimeout(timer);
      if (document.hidden) { request?.abort(); return; }
      void refresh();
    }
    reload.current = () => { sessionExpired = false; wake(); };
    document.addEventListener('visibilitychange', wake);
    void refresh();
    return () => { disposed = true; if (timer) clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', wake); };
  }, []);
  const jobs = snapshot?.jobs ?? [];
  const { counts, byRole } = activitySummary(jobs);
  const visibleJobs = filterActivity(jobs, filter);
  const connected = snapshot?.connected === true;
  return <div className="shell">
    <aside><p className="eyebrow">ODDMASH</p><h1>{t("Agents Console")}</h1><p className="muted">{t("Release:")} {typeof releaseTag === 'string' && /^v\d+\.\d+\.\d+$/.test(releaseTag) ? releaseTag : t("Unknown")}</p><nav aria-label={t('Console navigation')}>{views.map(item => <a key={item} href={'#' + item} aria-current={view === item ? 'page' : undefined}>{t(viewLabels[item])}</a>)}</nav><div className="logout">{languageControl}{logout}</div></aside>
    <main>
      <header><div><h2>{t(viewLabels[view])}</h2></div><Button variant="secondary" onClick={() => reload.current()}>{t("Refresh")}</Button></header>
      <p role="status" aria-live="polite" className="muted">{loading ? t("Loading status…") : error ? t(error) + (snapshot?.connected ? t(" Showing the last successful snapshot.") : '') : (snapshot?.connected ? t("Connected to worker telemetry") : t("Telemetry storage is not configured."))}</p>
      <section hidden={view !== 'overview'} id="overview" className="metrics" aria-label={t("Overview")}>
        <Card><p>{t("Running")}</p><strong>{connected ? counts.running : '—'}</strong></Card>
        <Card><p>{t("Queued")}</p><strong>{connected ? counts.queued : '—'}</strong></Card>
        <Card><p>{t("Stale observations")}</p><strong>{connected ? counts.stale : '—'}</strong></Card>
        <Card><p>{t("Recent failures")}</p><strong>{connected ? counts.failed : '—'}</strong></Card>
        <Card><p>{t("Enabled and configured agents")}</p><strong>{snapshot?.settings ? snapshot.settings.agents.filter(agent => agent.enabled && agent.configured).length : '—'}</strong></Card>
      </section>
      <section hidden={view !== 'overview'} aria-labelledby="role-overview"><h2 id="role-overview">{t("Agent activity")}</h2><p className="muted">{t("Counts reflect only retained execution events, not service health. Stale means no recent update; returned does not imply approval.")}</p><div className="agent-grid">{byRole.map(row => <Card key={row.role}><h3><AgentIdentity role={row.role}/></h3><p className="role-description">{t(descriptions[row.role])}</p><Badge tone={connected && row.latest?.state === 'running' ? 'accent' : 'neutral'}>{connected && row.latest ? t(row.latest.state) : connected ? t('No observed events') : t('Unavailable')}</Badge><p>{t("Active:")} {connected ? row.active : '—'} · {t("Failed:")} {connected ? row.failed : '—'} · {t("Stale:")} {connected ? row.stale : '—'}</p>{connected && row.latest ? <p>{t("Last update:")} <time dateTime={row.latest.updatedAt}>{new Date(row.latest.updatedAt).toLocaleString(language)}</time></p> : null}</Card>)}</div></section>
      <section hidden={view !== 'activity'} id="activity"><p className="muted">{t("Actual worker lifecycle events. Returned means the execution ended without asserting approval. Queued elapsed time is the wait since the last queued event.")}</p>
        <div className="activity-filters"><label>{t("Agent")}<Select value={filter.role} onChange={event => setFilter(current => ({ ...current, role: event.target.value as ActivityFilter['role'] }))}><option value="all">{t("All agents")}</option>{byRole.map(row => <option key={row.role} value={row.role}>{names[row.role]}</option>)}</Select></label><label>{t("State")}<Select value={filter.state} onChange={event => setFilter(current => ({ ...current, state: event.target.value as ActivityFilter['state'] }))}><option value="all">{t("All states")}</option>{jobStates.map(state => <option key={state} value={state}>{t(state)}</option>)}</Select></label><span role="status" className="muted">{connected ? executionCount(language, visibleJobs.length, jobs.length) : t("No live activity source")}</span></div>
        <Card className="activity"><div className="table-wrap"><table><thead><tr><th>{t("Agent")}</th><th>{t("Target")}</th><th>{t("Phase")}</th><th>{t("State")}</th><th>{t("Attempt")}</th><th>{t("Elapsed")}</th><th>{t("Updated")}</th></tr></thead><tbody>{visibleJobs.map(job => <tr key={job.role + ':' + job.correlationId + ':' + job.attempt}><td><AgentIdentity role={job.role} compact/></td><td>{job.target ? <a href={'https://github.com/' + job.target.repository + '/issues/' + job.target.number} target="_blank" rel="noreferrer">{job.target.repository.split('/')[1]} #{job.target.number}</a> : t("Not reported")}</td><td>{job.phase ? t(job.phase) : '—'}</td><td><Badge tone={job.state === 'running' ? 'accent' : 'neutral'}>{t(job.state)}</Badge>{job.failure && <small>{Object.hasOwn(korean, job.failure) ? t(job.failure as Message) : t("unexpected")}</small>}</td><td>{job.attempt}</td><td>{formatElapsed(job, language, snapshot?.observedAt)}</td><td><time dateTime={job.updatedAt}>{new Date(job.updatedAt).toLocaleString(language)}</time></td></tr>)}</tbody></table></div>{!visibleJobs.length && <p className="empty">{!connected ? t("Live activity unavailable.") : jobs.length ? t("No executions match these filters.") : t("No recent execution events.")}</p>}</Card>
      </section>
      <section hidden={view !== 'usage'} id="usage"><p className="muted">{t("Observed usage in retained terminal executions, including retries. Missing counts and unobserved calls are not zero-cost; these are token counts, not a billing total.")}</p><div className="agent-grid">{snapshot?.usage?.length ? snapshot.usage.map(row => <Card key={row.role}><h3><AgentIdentity role={row.role}/></h3><p>{t("Observed calls:")} {row.calls}</p><p>{t("Known input tokens:")} {row.inputTokens.toLocaleString(language)} · {missingCalls(language, row.missingInput)}</p><p>{t("Known output tokens:")} {row.outputTokens.toLocaleString(language)} · {missingCalls(language, row.missingOutput)}</p></Card>) : <Card><p className="empty">{t("No measured model usage is retained yet.")}</p></Card>}</div></section>
      <section hidden={view !== 'settings'} id="settings"><p className="muted">{t("Read-only snapshot of effective worker settings. Credentials are never returned.")} {snapshot?.settingsUpdatedAt && <span>{t("Updated")}: {new Date(snapshot.settingsUpdatedAt).toLocaleString(language)}</span>}</p>
        {snapshot?.settings ? <><div className="metrics"><Card>{t("Queue")} <strong>{snapshot.settings.queueEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Coordinated advisories")} <strong>{snapshot.settings.coordinatedAdvisoriesEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Authenticated guidance")} <strong>{snapshot.settings.authenticatedGuidanceEnabled === undefined ? t("Unknown") : snapshot.settings.authenticatedGuidanceEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Scoped thread resolution")} <strong>{snapshot.settings.scopedThreadResolutionEnabled === undefined ? t("Unknown") : snapshot.settings.scopedThreadResolutionEnabled ? t("Enabled") : t("Disabled")}</strong></Card><Card>{t("Advisory request limit")} <strong>{snapshot.settings.advisoryMaxRequests ?? t("Unknown")}</strong></Card><Card>{t("Advisory time budget")} <strong>{snapshot.settings.advisoryMaxMs === undefined ? t("Unknown") : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(snapshot.settings.advisoryMaxMs / 1000)}</strong></Card></div><div className="agent-grid">{snapshot.settings.agents.map(agent => <Card key={agent.role}><h3><AgentIdentity role={agent.role}/></h3><Badge>{agent.enabled ? t("Enabled") : t("Disabled")}</Badge><p>{t("Model:")} {agent.model ?? t("Unknown")}</p><p>{t("Configuration:")} {agent.configured ? t("Present") : t("Incomplete")}</p><p>{t("Auto-merge:")} {agent.autoMerge ? t("Enabled") : t("Disabled")}</p></Card>)}</div></> : <Card><p className="empty">{t("No worker configuration snapshot is available.")}</p></Card>}
      </section>
      {snapshot && <p className="muted">{t("Last observed:")} <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString(language)}</time></p>}
    </main></div>;
}
