import { resolveDateRange, type DateRange } from './date-range.ts';
import { roles, type AgentRole, type Job, type JobState } from '@oddmash/agent-operator-contract';

export const jobStates = ['queued', 'running', 'returned', 'failed', 'stale', 'skipped', 'published'] as const;
export type ActivityFilter = { role: AgentRole | 'all'; state: JobState | 'all'; repository?: string; day?: string; range?: DateRange };

export function activitySummary(jobs: readonly Job[]) {
  const counts = { queued: 0, running: 0, returned: 0, failed: 0, stale: 0, skipped: 0, published: 0 };
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
  const range = filter.range && resolveDateRange(filter.range);
  if (filter.range && !range) return [];
  return jobs.filter(job => (!range || Date.parse(job.updatedAt) >= range.from && Date.parse(job.updatedAt) <= range.to) && (filter.role === 'all' || job.role === filter.role) && (filter.state === 'all' || job.state === filter.state) && (!filter.repository || filter.repository === 'all' || repositoryKey(job) === filter.repository) && (!filter.day || filter.day === 'all' || localDay(job.updatedAt) === filter.day));
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
  return [...groups.values()].map(group => ({ ...group, jobs: group.jobs.sort((a, b) => priority(a) - priority(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) })).sort((a, b) => Number(!a.target) - Number(!b.target) || priority(a.jobs[0]) - priority(b.jobs[0]) || Date.parse(b.jobs[0].updatedAt) - Date.parse(a.jobs[0].updatedAt));
}

export function reviewOverview(groups: ReturnType<typeof groupActivity>, limit = 5) {
  const identified = groups.filter(group => group.target);
  return {
    groups: identified.slice(0, limit).map(group => {
      const seen = new Set<Job['role']>();
      const jobs = group.jobs.filter(job => {
        if (seen.has(job.role)) return false;
        seen.add(job.role);
        return true;
      });
      return { ...group, jobs, total: group.jobs.length };
    }),
    identifiedCount: identified.length,
    unattributedCount: groups.filter(group => !group.target).reduce((total, group) => total + group.jobs.length, 0)
  };
}

export const repositoryKey = (job: Job) => job.target?.repository.toLowerCase() ?? 'unreported';

export function localDay(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function activityDays(jobs: readonly Job[]): string[] {
  return [...new Set(jobs.map(job => localDay(job.updatedAt)).filter(Boolean))].sort().reverse();
}

export function repositoryActivity(jobs: readonly Job[]) {
  const repositories = new Map<string, { key: string; repository?: string; jobs: Job[]; active: number; failed: number; latest: number }>();
  for (const job of jobs) {
    const key = repositoryKey(job);
    const row = repositories.get(key) ?? { key, repository: job.target?.repository, jobs: [], active: 0, failed: 0, latest: 0 };
    row.jobs.push(job);
    if (job.state === 'running' || job.state === 'queued') row.active++;
    if (job.state === 'failed') row.failed++;
    row.latest = Math.max(row.latest, Date.parse(job.updatedAt));
    repositories.set(key, row);
  }
  return [...repositories.values()].sort((a, b) => Number(!a.repository) - Number(!b.repository) || b.active - a.active || b.latest - a.latest || a.key.localeCompare(b.key));
}

export function toggleRepositoryCollapse(previous: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(previous);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function metricFilter(state: ActivityFilter['state']): ActivityFilter {
  return { role: 'all', state };
}

export function historyNeedsRepository(view: string, filter: ActivityFilter): boolean {
  return view === 'activity' && (!filter.repository || filter.repository === 'all');
}

export function withRepositoryFilter(filter: ActivityFilter, repository?: string): ActivityFilter {
  return { ...filter, repository: repository === 'all' ? undefined : repository };
}
