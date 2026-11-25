'use client';

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Badge, Button, Card } from '@oddmash/ui';
import type { Job, WorkerSettings } from '@oddmash/agent-operator-contract';

type Snapshot = { connected: boolean; jobs: Job[]; settings: WorkerSettings | null; settingsUpdatedAt?: string; observedAt: string };
const names = { reviewer: 'Lead', impact: 'Impact', triage: 'Triage', qa: 'QA', release: 'Release', docs: 'Docs', architect: 'Architect' };

export function Dashboard({ logout }: { logout: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    async function refresh() {
      if (disposed || document.hidden || request) return;
      request = new AbortController();
      let delay = 30000;
      try {
        const response = await fetch('/api/status', { cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('Status unavailable');
        const data = await response.json() as Snapshot;
        if (!disposed) { setSnapshot(data); setError(''); }
        if (data.jobs.some(job => job.state === 'running' || job.state === 'queued')) delay = 10000;
      } catch {
        if (!disposed && !document.hidden) setError('Unable to refresh live status. Try again.');
      } finally {
        request = undefined;
        if (!disposed) setLoading(false);
        if (!disposed && !document.hidden) timer = setTimeout(refresh, delay);
      }
    }
    function wake() {
      if (timer) clearTimeout(timer);
      if (document.hidden) { request?.abort(); return; }
      void refresh();
    }
    reload.current = wake;
    document.addEventListener('visibilitychange', wake);
    void refresh();
    return () => { disposed = true; if (timer) clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', wake); };
  }, []);
  const jobs = snapshot?.jobs ?? [];
  const active = jobs.filter(job => job.state === 'running' || job.state === 'queued');
  const failed = jobs.filter(job => job.state === 'failed');
  return <div className="shell">
    <aside><p className="eyebrow">ODDMASH</p><h1>Agents Console</h1><nav aria-label="Console navigation"><a href="#overview">Overview</a><a href="#activity">Live activity</a><a href="#settings">Configuration</a></nav><div className="logout">{logout}</div></aside>
    <main>
      <header><div><p className="eyebrow">OPERATOR WORKSPACE</p><h2>Overview</h2></div><Button variant="secondary" onClick={() => reload.current()}>Refresh</Button></header>
      <p role="status" aria-live="polite" className="muted">{loading ? 'Loading status…' : error || (snapshot?.connected ? 'Connected to worker telemetry' : 'Telemetry storage is not configured.')}</p>
      <section id="overview" className="metrics" aria-label="Overview">
        <Card><p>Active jobs</p><strong>{snapshot?.connected ? active.length : '—'}</strong></Card>
        <Card><p>Recent failures</p><strong>{snapshot?.connected ? failed.length : '—'}</strong></Card>
        <Card><p>Configured agents</p><strong>{snapshot?.settings ? snapshot.settings.agents.filter(agent => agent.configured).length : '—'}</strong></Card>
      </section>
      <section id="activity"><h2>Live activity</h2><p className="muted">Actual worker lifecycle events. Returned does not imply approval.</p>
        <Card className="activity"><div className="table-wrap"><table><thead><tr><th>Agent</th><th>Target</th><th>Phase</th><th>State</th><th>Elapsed</th><th>Updated</th></tr></thead><tbody>{jobs.map(job => <tr key={job.role + job.correlationId}><td>{names[job.role]}</td><td>{job.target ? <a href={'https://github.com/' + job.target.repository + '/issues/' + job.target.number} target="_blank" rel="noreferrer">{job.target.repository.split('/')[1]} #{job.target.number}</a> : 'Not reported'}</td><td>{job.phase?.replaceAll('-', ' ') ?? '—'}</td><td><Badge>{job.state}</Badge>{job.failure && <small>{job.failure}</small>}</td><td>{job.durationMs !== undefined ? Math.round(job.durationMs / 1000) + 's' : job.startedAt && (job.state === 'running' || job.state === 'stale') && snapshot ? Math.max(0, Math.round((Date.parse(snapshot.observedAt) - Date.parse(job.startedAt)) / 1000)) + 's' : '—'}</td><td><time dateTime={job.updatedAt}>{new Date(job.updatedAt).toLocaleString()}</time></td></tr>)}</tbody></table></div>{!jobs.length && <p className="empty">{snapshot?.connected ? 'No recent execution events.' : 'Live activity unavailable.'}</p>}</Card>
      </section>
      <section id="settings"><h2>Configuration</h2><p className="muted">Read-only snapshot of effective worker settings. Credentials are never returned. {snapshot?.settingsUpdatedAt && <span>Recorded {new Date(snapshot.settingsUpdatedAt).toLocaleString()}.</span>}</p>
        {snapshot?.settings ? <><div className="metrics"><Card>Queue <strong>{snapshot.settings.queueEnabled ? 'Enabled' : 'Disabled'}</strong></Card><Card>Coordinated advisories <strong>{snapshot.settings.coordinatedAdvisoriesEnabled ? 'Enabled' : 'Disabled'}</strong></Card></div><div className="agent-grid">{snapshot.settings.agents.map(agent => <Card key={agent.role}><h3>{names[agent.role]}</h3><Badge>{agent.enabled ? 'Enabled' : 'Disabled'}</Badge><p>Model: {agent.model ?? 'Unknown'}</p><p>Configuration: {agent.configured ? 'Present' : 'Incomplete'}</p><p>Auto-merge: {agent.autoMerge ? 'Enabled' : 'Disabled'}</p></Card>)}</div></> : <Card><p className="empty">No worker configuration snapshot is available.</p></Card>}
      </section>
      {snapshot && <p className="muted">Last observed: <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString()}</time></p>}
    </main></div>;
}
