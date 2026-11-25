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
