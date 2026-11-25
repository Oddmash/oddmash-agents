import type { AgentRole, Job, PublicTarget } from '@oddmash/agent-operator-contract';

export const specialistRoles = ['impact', 'qa', 'docs', 'architect', 'release'] as const;
export type WorkflowRole = AgentRole;
export type WorkflowState = 'running' | 'queued' | 'returned' | 'failed' | 'stale' | 'skipped' | 'published';
export type ObservedJob = Job & { skipReason?: string; publication?: { kind: 'review' | 'comment' | 'inline-comment'; at: string; id?: number } };

export const workflowRoles: readonly WorkflowRole[] = ['triage', 'reviewer', ...specialistRoles];

export const targetObservations = (target: PublicTarget, jobs: readonly ObservedJob[]): ObservedJob[] =>
  jobs.filter(job => job.target?.repository.toLowerCase() === target.repository.toLowerCase() && job.target.number === target.number)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export const roleObservations = (role: WorkflowRole, jobs: readonly ObservedJob[]) => jobs.filter(job => job.role === role);

export const stateCounts = (jobs: readonly ObservedJob[]) => {
  const counts: Partial<Record<WorkflowState, number>> = {};
  for (const job of jobs) {
    const state: string = job.state;
    if (['running', 'queued', 'returned', 'failed', 'stale', 'skipped', 'published'].includes(state)) {
      const key = state as WorkflowState;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
};

export const publicationObservations = (jobs: readonly ObservedJob[]) => jobs.filter(job => job.publication !== undefined);
export const publicationPhaseObserved = (jobs: readonly ObservedJob[]) => jobs.some(job => job.phase === 'publishing' || job.phaseHistory?.some(entry => entry.phase === 'publishing'));

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
