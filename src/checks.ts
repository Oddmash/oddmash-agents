import { checksPassed, type ReviewDecision } from './core.ts';
export type Check = { id?: number; name: string; status: string; conclusion: string | null; app?: { id: number } };
export type CheckEvidence = { total_count?: number; check_runs: Check[] };

export function reviewChecksReady(evidence: CheckEvidence): boolean {
  return !!evidence.total_count && evidence.total_count === evidence.check_runs.length && evidence.check_runs.every(check => check.status === 'completed') && evidence.check_runs.some(check => /^(?:CI \/ )?verify$/.test(check.name) && (check.app === undefined || check.app.id === 15368));
}

export function finalReviewEvent(assessment: ReviewDecision, evidence: CheckEvidence): ReviewDecision | null {
  if (!reviewChecksReady(evidence)) return null;
  if (assessment === 'REQUEST_CHANGES') return assessment;
  return checksPassed(evidence.check_runs) ? assessment : null;
}

export async function loadCheckEvidence(head: string, merge: string | null | undefined, read: (sha: string) => Promise<CheckEvidence | null>): Promise<CheckEvidence> {
  const refs = [head];
  if (merge && /^[a-f0-9]{40}$/i.test(merge) && merge !== head) refs.push(merge);
  const evidence = await Promise.all(refs.map(read));
  return { total_count: evidence.reduce((sum, item) => sum + (item?.total_count ?? item?.check_runs.length ?? 0), 0), check_runs: evidence.flatMap(item => item?.check_runs ?? []) };
}
