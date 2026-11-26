import type { AgentRole, Job, JobState, PublicTarget } from '@oddmash/agent-operator-contract';

export const specialistRoles = ['impact', 'qa', 'docs', 'architect', 'release'] as const;
export type WorkflowRole = AgentRole;
export type WorkflowState = JobState;
export type ObservedJob = Job;

export const workflowRoles: readonly WorkflowRole[] = ['triage', 'reviewer', ...specialistRoles];

export const targetObservations = (target: PublicTarget, jobs: readonly ObservedJob[]): ObservedJob[] =>
  jobs.filter(job => job.target?.repository.toLowerCase() === target.repository.toLowerCase() && job.target.number === target.number)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export const roleObservations = (role: WorkflowRole, jobs: readonly ObservedJob[]) => jobs.filter(job => job.role === role);

export const stateCounts = (jobs: readonly ObservedJob[]) => {
  const counts: Partial<Record<WorkflowState, number>> = {};
  for (const job of jobs) {
    const state = job.state;
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
};

export const publicationObservations = (jobs: readonly ObservedJob[]) => jobs.filter(job => job.publication !== undefined);
export const publicationPhaseObserved = (jobs: readonly ObservedJob[]) => jobs.some(job => job.phase === 'publishing' || job.phaseHistory?.some(entry => entry.phase === 'publishing'));
export const publicationStageObservations = (jobs: readonly ObservedJob[]) => jobs.filter(job => job.publication !== undefined || publicationPhaseObserved([job]));

export function publicationLink(target: PublicTarget, job: ObservedJob): string | undefined {
  const result = job.publication;
  if (!job.target || job.target.repository.toLowerCase() !== target.repository.toLowerCase() || job.target.number !== target.number) return;
  if (!result || !Number.isSafeInteger(result.id) || (result.id ?? 0) <= 0) return;
  return 'https://github.com/' + target.repository + (result.kind === 'review' ? '/pull/' + target.number + '#pullrequestreview-' : result.kind === 'inline-comment' ? '/pull/' + target.number + '#discussion_r' : '/issues/' + target.number + '#issuecomment-') + result.id;
}

export function executionGroups(jobs: readonly ObservedJob[]) {
  const groups = new Map<string, ObservedJob[]>();
  for (const job of jobs) {
    const key = job.role + ':' + job.correlationId;
    const group = groups.get(key) ?? [];
    group.push(job);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, records]) => ({ key, records: records.sort((a, b) => b.attempt - a.attempt) }));
}

export function publicationCounts(jobs: readonly ObservedJob[]) {
  return { review: jobs.filter(job => job.publication?.kind === 'review').length, 'inline-comment': jobs.filter(job => job.publication?.kind === 'inline-comment').length, comment: jobs.filter(job => job.publication?.kind === 'comment').length };
}

export const latestObservation = (jobs: readonly ObservedJob[]): ObservedJob | undefined =>
  jobs.reduce<ObservedJob | undefined>((latest, job) => !latest || Date.parse(job.updatedAt) > Date.parse(latest.updatedAt) ||
    (Date.parse(job.updatedAt) === Date.parse(latest.updatedAt) && job.attempt > latest.attempt) ? job : latest, undefined);

export const observedStages = (job: ObservedJob) => {
  const history = job.phaseHistory ?? [];
  return history.map((entry, index) => {
    const next = history[index + 1];
    const last = !next;
    const matches = last && job.phase === entry.phase;
    const failure = matches && job.state === 'failed';
    const end = next?.timestamp ?? (matches ? job.finishedAt : undefined);
    const interval = Date.parse(end ?? '') - Date.parse(entry.timestamp);
    return { ...entry, intervalMs: Number.isFinite(interval) && interval >= 0 ? interval : undefined,
      state: failure ? 'failed' as const : matches && job.state === 'running' ? 'running' as const : 'observed' as const };
  });
};

export function workflowRoleGroups(jobs: readonly ObservedJob[]) {
  const observed = workflowRoles.filter(role => jobs.some(job => job.role === role));
  const priority = (role: WorkflowRole) => {
    const records = roleObservations(role, jobs);
    return records.some(job => job.state === 'failed') ? 0 : records.some(job => job.state === 'running' || job.state === 'queued') ? 1 : 2;
  };
  const latestAt = (role: WorkflowRole) => {
    const matching = roleObservations(role, jobs);
    const rank = priority(role);
    const relevant = rank === 0 ? matching.filter(job => job.state === 'failed') : rank === 1 ? matching.filter(job => job.state === 'running' || job.state === 'queued') : matching;
    return Date.parse(latestObservation(relevant)?.updatedAt ?? '') || 0;
  };
  return { observed: [...observed].sort((a,b) => priority(a) - priority(b) || latestAt(b) - latestAt(a)), unobserved: workflowRoles.filter(role => !observed.includes(role)) };
}
