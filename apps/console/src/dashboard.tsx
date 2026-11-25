import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Badge, Button, Card } from '@oddmash/ui';
import { jobElapsedMs, type Job, type WorkerSettings, type ModelUsageSummary, type AgentRole } from '@oddmash/agent-operator-contract';
import { activitySummary, filterActivity, jobStates, type ActivityFilter } from './activity';

type Snapshot = { connected: boolean; jobs: Job[]; usage?: (ModelUsageSummary & { role: AgentRole })[]; settings: WorkerSettings | null; settingsUpdatedAt?: string; observedAt: string };
const releaseTag = (import.meta as ImportMeta & { env: { VITE_OPERATOR_RELEASE_TAG?: string } }).env.VITE_OPERATOR_RELEASE_TAG;
const names = { reviewer: 'Lead', impact: 'Impact', triage: 'Triage', qa: 'QA', release: 'Release', docs: 'Docs', architect: 'Architect' };

function formatElapsed(job: Job, observedAt?: string) {
  const elapsed = observedAt ? jobElapsedMs(job, observedAt) : undefined;
  return elapsed === undefined ? '—' : Math.round(elapsed / 1000) + 's';
}

export function Dashboard({ logout }: { logout: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
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
    <aside><p className="eyebrow">ODDMASH</p><h1>Agents Console</h1><p className="muted">Release: {typeof releaseTag === 'string' && /^v\d+\.\d+\.\d+$/.test(releaseTag) ? releaseTag : 'Unknown'}</p><nav aria-label="Console navigation"><a href="#overview">Overview</a><a href="#activity">Live activity</a><a href="#usage">Model usage</a><a href="#settings">Configuration</a></nav><div className="logout">{logout}</div></aside>
    <main>
      <header><div><p className="eyebrow">OPERATOR WORKSPACE</p><h2>Overview</h2></div><Button variant="secondary" onClick={() => reload.current()}>Refresh</Button></header>
      <p role="status" aria-live="polite" className="muted">{loading ? 'Loading status…' : error ? error + (snapshot?.connected ? ' Showing the last successful snapshot.' : '') : (snapshot?.connected ? 'Connected to worker telemetry' : 'Telemetry storage is not configured.')}</p>
      <section id="overview" className="metrics" aria-label="Overview">
        <Card><p>Running</p><strong>{connected ? counts.running : '—'}</strong></Card>
        <Card><p>Queued</p><strong>{connected ? counts.queued : '—'}</strong></Card>
        <Card><p>Stale observations</p><strong>{connected ? counts.stale : '—'}</strong></Card>
        <Card><p>Recent failures</p><strong>{connected ? counts.failed : '—'}</strong></Card>
        <Card><p>Enabled and configured agents</p><strong>{snapshot?.settings ? snapshot.settings.agents.filter(agent => agent.enabled && agent.configured).length : '—'}</strong></Card>
      </section>
      <section aria-labelledby="role-overview"><h2 id="role-overview">Agent activity</h2><p className="muted">Counts reflect only retained execution events, not service health. Stale means no recent update; returned does not imply approval.</p><div className="agent-grid">{byRole.map(row => <Card key={row.role}><h3>{names[row.role]}</h3><Badge>{connected ? row.latest?.state ?? 'No observed events' : 'Unavailable'}</Badge><p>Active: {connected ? row.active : '—'} · Failed: {connected ? row.failed : '—'} · Stale: {connected ? row.stale : '—'}</p>{connected && row.latest ? <p>Last update: <time dateTime={row.latest.updatedAt}>{new Date(row.latest.updatedAt).toLocaleString()}</time></p> : null}</Card>)}</div></section>
      <section id="activity"><h2>Live activity</h2><p className="muted">Actual worker lifecycle events. Returned means the execution ended without asserting approval. Queued elapsed time is the wait since the last queued event.</p>
        <div className="activity-filters"><label>Agent<select value={filter.role} onChange={event => setFilter(current => ({ ...current, role: event.target.value as ActivityFilter['role'] }))}><option value="all">All agents</option>{byRole.map(row => <option key={row.role} value={row.role}>{names[row.role]}</option>)}</select></label><label>State<select value={filter.state} onChange={event => setFilter(current => ({ ...current, state: event.target.value as ActivityFilter['state'] }))}><option value="all">All states</option>{jobStates.map(state => <option key={state} value={state}>{state}</option>)}</select></label><span role="status" className="muted">{connected ? `${visibleJobs.length} of ${jobs.length} executions` : 'No live activity source'}</span></div>
        <Card className="activity"><div className="table-wrap"><table><thead><tr><th>Agent</th><th>Target</th><th>Phase</th><th>State</th><th>Attempt</th><th>Elapsed</th><th>Updated</th></tr></thead><tbody>{visibleJobs.map(job => <tr key={job.role + ':' + job.correlationId + ':' + job.attempt}><td>{names[job.role]}</td><td>{job.target ? <a href={'https://github.com/' + job.target.repository + '/issues/' + job.target.number} target="_blank" rel="noreferrer">{job.target.repository.split('/')[1]} #{job.target.number}</a> : 'Not reported'}</td><td>{job.phase?.replaceAll('-', ' ') ?? '—'}</td><td><Badge>{job.state}</Badge>{job.failure && <small>{job.failure}</small>}</td><td>{job.attempt}</td><td>{formatElapsed(job, snapshot?.observedAt)}</td><td><time dateTime={job.updatedAt}>{new Date(job.updatedAt).toLocaleString()}</time></td></tr>)}</tbody></table></div>{!visibleJobs.length && <p className="empty">{!connected ? 'Live activity unavailable.' : jobs.length ? 'No executions match these filters.' : 'No recent execution events.'}</p>}</Card>
      </section>
      <section id="usage"><h2>Model usage</h2><p className="muted">Observed usage in retained terminal executions, including retries. Missing counts and unobserved calls are not zero-cost; these are token counts, not a billing total.</p><div className="agent-grid">{snapshot?.usage?.length ? snapshot.usage.map(row => <Card key={row.role}><h3>{names[row.role]}</h3><p>Observed calls: {row.calls}</p><p>Known input tokens: {row.inputTokens.toLocaleString()} · missing in {row.missingInput} calls</p><p>Known output tokens: {row.outputTokens.toLocaleString()} · missing in {row.missingOutput} calls</p></Card>) : <Card><p className="empty">No measured model usage is retained yet.</p></Card>}</div></section>
      <section id="settings"><h2>Configuration</h2><p className="muted">Read-only snapshot of effective worker settings. Credentials are never returned. {snapshot?.settingsUpdatedAt && <span>Recorded {new Date(snapshot.settingsUpdatedAt).toLocaleString()}.</span>}</p>
        {snapshot?.settings ? <><div className="metrics"><Card>Queue <strong>{snapshot.settings.queueEnabled ? 'Enabled' : 'Disabled'}</strong></Card><Card>Coordinated advisories <strong>{snapshot.settings.coordinatedAdvisoriesEnabled ? 'Enabled' : 'Disabled'}</strong></Card><Card>Authenticated guidance <strong>{snapshot.settings.authenticatedGuidanceEnabled === undefined ? 'Unknown' : snapshot.settings.authenticatedGuidanceEnabled ? 'Enabled' : 'Disabled'}</strong></Card><Card>Scoped thread resolution <strong>{snapshot.settings.scopedThreadResolutionEnabled === undefined ? 'Unknown' : snapshot.settings.scopedThreadResolutionEnabled ? 'Enabled' : 'Disabled'}</strong></Card><Card>Advisory request limit <strong>{snapshot.settings.advisoryMaxRequests ?? 'Unknown'}</strong></Card><Card>Advisory time budget <strong>{snapshot.settings.advisoryMaxMs === undefined ? 'Unknown' : snapshot.settings.advisoryMaxMs / 1000 + 's'}</strong></Card></div><div className="agent-grid">{snapshot.settings.agents.map(agent => <Card key={agent.role}><h3>{names[agent.role]}</h3><Badge>{agent.enabled ? 'Enabled' : 'Disabled'}</Badge><p>Model: {agent.model ?? 'Unknown'}</p><p>Configuration: {agent.configured ? 'Present' : 'Incomplete'}</p><p>Auto-merge: {agent.autoMerge ? 'Enabled' : 'Disabled'}</p></Card>)}</div></> : <Card><p className="empty">No worker configuration snapshot is available.</p></Card>}
      </section>
      {snapshot && <p className="muted">Last observed: <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString()}</time></p>}
    </main></div>;
}
