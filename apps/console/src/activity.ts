import { roles, type AgentRole, type Job, type JobState } from '@oddmash/agent-operator-contract';

export const jobStates = ['queued', 'running', 'returned', 'failed', 'stale'] as const;
export type ActivityFilter = { role: AgentRole | 'all'; state: JobState | 'all' };

export function activitySummary(jobs: readonly Job[]) {
  const counts = { queued: 0, running: 0, returned: 0, failed: 0, stale: 0 };
  const byRole = roles.map(role => ({ role, active: 0, failed: 0, stale: 0, latest: undefined as Job | undefined }));
  const indexed = new Map(byRole.map(role => [role.role, role]));
  for (const job of jobs) {
    const role = indexed.get(job.role);
    if (!role) continue;
    counts[job.state]++;
    if (job.state === 'running' || job.state === 'queued') role.active++;
    if (job.state === 'failed') role.failed++;
    if (job.state === 'stale') role.stale++;
    if (!role.latest || Date.parse(job.updatedAt) > Date.parse(role.latest.updatedAt)) role.latest = job;
  }
  return { counts, byRole };
}

export function filterActivity(jobs: readonly Job[], filter: ActivityFilter): Job[] {
  return jobs.filter(job => (filter.role === 'all' || job.role === filter.role) && (filter.state === 'all' || job.state === filter.state));
}

export function groupActivity(jobs: readonly Job[]) {
  const groups = new Map<string, { key: string; target: Job['target']; jobs: Job[] }>();
  const priority = (job: Job) => job.state === 'running' || job.state === 'queued' ? 0 : job.state === 'failed' || job.state === 'stale' ? 1 : 2;
  for (const job of jobs) {
    const key = job.target ? job.target.repository.toLowerCase() + '#' + job.target.number : 'unreported';
    const group = groups.get(key) ?? { key, target: job.target, jobs: [] };
    group.jobs.push(job);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, jobs: group.jobs.sort((a, b) => priority(a) - priority(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) })).sort((a, b) => priority(a.jobs[0]) - priority(b.jobs[0]) || Date.parse(b.jobs[0].updatedAt) - Date.parse(a.jobs[0].updatedAt));
}
