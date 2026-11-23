import { checksPassed, type ReviewDecision } from './core.ts';
export type Check = { id?: number; name: string; status: string; conclusion: string | null; app?: { id: number } };
export type CheckEvidence = { total_count?: number; check_runs: Check[] };

const boundraChecks = [
  'verify-example', 'verify-runtime (20)', 'verify-runtime (22)', 'verify-runtime (24)',
  'verify-cli-platforms (ubuntu-24.04)', 'verify-cli-platforms (macos-15)',
  'verify-cli-platforms (macos-15-intel)', 'verify-cli-platforms (windows-2025)', 'benchmark-smoke'
];

const reviewProfiles: Readonly<Record<string, { workflow: string; names: readonly string[] }>> = {
  'Oddmash/boundra': { workflow: 'Boundra', names: boundraChecks }
};

function requiredReviewChecks(evidence: CheckEvidence, repository?: string): Check[][] {
  const profile = repository && Object.hasOwn(reviewProfiles, repository) ? reviewProfiles[repository] : undefined;
  if (profile) return profile.names.map(name => evidence.check_runs.filter(check => check.app?.id === 15368 && (check.name === name || check.name === `${profile.workflow} / ${name}`)));
  return [evidence.check_runs.filter(check => /^(?:CI \/ )?verify$/.test(check.name) && (check.app === undefined || check.app.id === 15368))];
}

export function reviewChecksReady(evidence: CheckEvidence, repository?: string): boolean {
  return !!evidence.total_count && evidence.total_count === evidence.check_runs.length && evidence.check_runs.every(check => check.status === 'completed') && requiredReviewChecks(evidence, repository).every(group => group.length > 0);
}

export function reviewChecksSuccessful(evidence: CheckEvidence, repository?: string): boolean {
  if (!reviewChecksReady(evidence, repository)) return false;
  return requiredReviewChecks(evidence, repository).every(group => group.every(check => check.conclusion === 'success')) && checksPassed(evidence.check_runs);
}

export function shouldReconcilePendingChecks(evidence: CheckEvidence, expectedHead: string | undefined, head: string, queueEnabled: boolean, repository?: string): boolean {
  return queueEnabled && expectedHead === head && /^[a-f0-9]{40}$/i.test(head) && !reviewChecksReady(evidence, repository);
}

export function finalReviewEvent(assessment: ReviewDecision, evidence: CheckEvidence, repository?: string): ReviewDecision | null {
  if (!reviewChecksReady(evidence, repository)) return null;
  if (assessment === 'REQUEST_CHANGES') return assessment;
  return reviewChecksSuccessful(evidence, repository) ? assessment : null;
}

export async function loadCheckEvidence(head: string, merge: string | null | undefined, read: (sha: string) => Promise<CheckEvidence | null>): Promise<CheckEvidence> {
  const refs = [head];
  if (merge && /^[a-f0-9]{40}$/i.test(merge) && merge !== head) refs.push(merge);
  const evidence = await Promise.all(refs.map(read));
  if (evidence.some(item => item === null)) return { check_runs: evidence.flatMap(item => item?.check_runs ?? []) };
  return { total_count: evidence.reduce((sum, item) => sum + (item?.total_count ?? item?.check_runs.length ?? 0), 0), check_runs: evidence.flatMap(item => item?.check_runs ?? []) };
}
