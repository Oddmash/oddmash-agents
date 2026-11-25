import { checksPassed, isMaintainerReviewAuthor, type ReviewDecision } from './core.ts';
import { progressCheckName } from './review-progress.ts';
import { githubRequest } from './github-request.ts';
export type Check = { id?: number; name: string; status: string; conclusion: string | null; app?: { id: number }; check_suite?: { id: number } };
export type CheckEvidence = { total_count?: number; check_runs: Check[]; workflowPending?: boolean };
type WorkflowRun = {
  workflow_id: number; run_number: number; check_suite_id: number; head_sha: string;
  event: string; status: string; conclusion: string | null;
  pull_requests: { number: number }[];
  head_branch?: string; head_repository?: { id: number } | null;
};
type WorkflowRuns = { total_count: number; workflow_runs: WorkflowRun[] };
export type ReviewCheckHead = { sha: string; ref?: string; repo?: { id: number; owner?: { login: string } } | null };
type PullSource = {
  head: ReviewCheckHead;
  readPulls: (path: string) => Promise<{ number: number; head: ReviewCheckHead }[] | null>;
};
const actionsApp = 15368;
const aggregateVerify = /^(?:CI \/ )?verify$/;

export function publicReviewCheckReader(root: string, number: number, read: (sha: string) => Promise<CheckEvidence | null>, request: typeof fetch = fetch, source?: PullSource) {
  return async (sha: string): Promise<CheckEvidence | null> => {
    const evidence = await read(sha);
    if (!evidence || evidence.total_count !== evidence.check_runs.length) return evidence;
    const actions = evidence.check_runs.filter(check => check.app?.id === actionsApp && check.check_suite?.id);
    const candidates = actions.filter(check => check.status === 'completed' && ['cancelled', 'failure'].includes(check.conclusion ?? ''));
    if (!candidates.length) return evidence;

    // Lead's installation token does not have Actions permission. This reader is only used for public repositories.
    const runs = await githubRequest(request, `${root}/actions/runs?head_sha=${sha}&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(5000)
    }).then(response => response.ok ? response.json() as Promise<WorkflowRuns> : null).catch(() => null);
    if (!Array.isArray(runs?.workflow_runs) || runs.total_count !== runs.workflow_runs.length) return evidence;

    const eligibleRuns = runs.workflow_runs.filter(run => run.head_sha === sha && run.event === 'pull_request');
    const head = source?.head;
    const repo = head?.repo;
    const owner = repo?.owner?.login;
    const branch = head?.ref;
    let unlisted: WorkflowRun[] = [];
    if (source && head?.sha === sha && owner && branch && Number.isSafeInteger(repo?.id)) {
      const candidates = eligibleRuns.filter(run => run.pull_requests?.length === 0 &&
        run.head_branch === branch && run.head_repository?.id === repo?.id);
      if (candidates.length) {
        // GitHub may omit PRs for fork runs. Require an unambiguous branch history in this base repository.
        const filter = new URLSearchParams({ state: 'all', head: owner + ':' + branch, per_page: '2' });
        const pulls = await source.readPulls(`${root}/pulls?${filter}`).catch(() => null);
        const pull = pulls?.[0];
        if (pulls?.length === 1 && pull?.number === number && pull.head.sha === sha &&
            pull.head.ref === branch && pull.head.repo?.id === repo?.id) unlisted = candidates;
      }
    }
    const related = eligibleRuns.filter(run => run.pull_requests?.some(pr => pr.number === number) || unlisted.includes(run));
    const superseded = new Set<number>();
    let workflowPending = false;
    for (const oldSuite of new Set(candidates.map(check => check.check_suite!.id))) {
      const cancelled = related.find(run => run.check_suite_id === oldSuite && run.status === 'completed' && run.conclusion === 'cancelled');
      if (!cancelled) continue;
      const current = related.filter(run => run.workflow_id === cancelled.workflow_id)
        .reduce((latest, run) => run.run_number > latest.run_number ? run : latest, cancelled);
      if (current.check_suite_id === oldSuite || current.run_number <= cancelled.run_number) continue;
      if (current.status !== 'completed') {
        superseded.add(oldSuite);
        workflowPending = true;
      } else if (current.conclusion === 'success') {
        const replacement = actions.filter(check => check.check_suite?.id === current.check_suite_id);
        const hadVerify = actions.some(check => check.check_suite?.id === oldSuite && aggregateVerify.test(check.name));
        superseded.add(oldSuite);
        if (!replacement.length || (hadVerify && !replacement.some(check => aggregateVerify.test(check.name)))) workflowPending = true;
      }
    }
    const check_runs = evidence.check_runs.filter(check => check.app?.id !== actionsApp || !superseded.has(check.check_suite?.id ?? 0));
    return { total_count: check_runs.length, check_runs, ...(workflowPending ? { workflowPending } : {}) };
  };
}

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
  if (profile) return [...profile.names, 'verify'].map(name => evidence.check_runs.filter(check => check.app?.id === actionsApp && (check.name === name || check.name === `${profile.workflow} / ${name}`)));
  return [evidence.check_runs.filter(check => aggregateVerify.test(check.name) && check.app?.id === actionsApp)];
}

export function checkWaitingSummary(evidence: CheckEvidence, repository?: string): string {
  const groups = requiredReviewChecks(evidence, repository);
  const missing = groups.filter(group => !group.length).length;
  const pending = evidence.check_runs.filter(check => check.status !== 'completed').length;
  const failed = evidence.check_runs.filter(check => check.status === 'completed' && !['success', 'skipped'].includes(check.conclusion ?? '')).length;
  const incomplete = evidence.total_count === undefined || evidence.total_count !== evidence.check_runs.length;
  const reasons = [
    incomplete ? 'Check evidence is incomplete.' : '',
    evidence.workflowPending ? 'The current workflow is still running or its check results are not available yet.' : '',
    missing ? `${missing} required check group(s) are missing (including the aggregate verify gate if absent).` : '',
    pending ? `${pending} check(s) are still running or queued.` : '',
    failed ? `${failed} completed check(s) did not pass.` : '',
    !missing && !pending && !failed && !incomplete && !reviewChecksSuccessful(evidence, repository) ? 'A required check did not conclude successfully.' : ''
  ].filter(Boolean);
  return `${reasons.join(' ')} Open this PR’s **Checks** tab and inspect the current commit’s required verify job, any unfinished or failed jobs, and the workflow run. Review remains subject to complete successful CI evidence.`;
}

export function reviewChecksReady(evidence: CheckEvidence, repository?: string): boolean {
  return !evidence.workflowPending && !!evidence.total_count && evidence.total_count === evidence.check_runs.length && evidence.check_runs.every(check => check.status === 'completed') && requiredReviewChecks(evidence, repository).every(group => group.length > 0);
}

export function reviewChecksSuccessful(evidence: CheckEvidence, repository?: string): boolean {
  if (!reviewChecksReady(evidence, repository)) return false;
  return requiredReviewChecks(evidence, repository).every(group => group.every(check => check.conclusion === 'success')) && checksPassed(evidence.check_runs);
}

export function shouldReconcilePendingChecks(evidence: CheckEvidence, expectedHead: string | undefined, head: string, queueEnabled: boolean, repository?: string): boolean {
  return queueEnabled && expectedHead === head && /^[a-f0-9]{40}$/i.test(head) && !reviewChecksReady(evidence, repository);
}

export function finalReviewEvent(assessment: ReviewDecision, evidence: CheckEvidence, repository?: string, author?: { id: number; login: string }): ReviewDecision | null {
  if (!reviewChecksReady(evidence, repository)) return null;
  if (assessment === 'REQUEST_CHANGES') return isMaintainerReviewAuthor(author) ? 'COMMENT' : assessment;
  return reviewChecksSuccessful(evidence, repository) ? assessment : null;
}

export async function loadCheckEvidence(head: string, merge: string | null | undefined, read: (sha: string) => Promise<CheckEvidence | null>, reviewerAppId = Number(process.env.REVIEWER_APP_ID)): Promise<CheckEvidence> {
  const refs = [head];
  if (merge && /^[a-f0-9]{40}$/i.test(merge) && merge !== head) refs.push(merge);
  const evidence = (await Promise.all(refs.map(read))).map(item => {
    if (!item || !Number.isSafeInteger(reviewerAppId) || reviewerAppId <= 0) return item;
    const check_runs = item.check_runs.filter(check => check.name !== progressCheckName || check.app?.id !== reviewerAppId);
    return { ...item, check_runs, total_count: (item.total_count ?? item.check_runs.length) - (item.check_runs.length - check_runs.length) };
  });
  if (evidence.some(item => item === null)) return { check_runs: evidence.flatMap(item => item?.check_runs ?? []) };
  const workflowPending = evidence.some(item => item?.workflowPending);
  return { total_count: evidence.reduce((sum, item) => sum + (item?.total_count ?? item?.check_runs.length ?? 0), 0), check_runs: evidence.flatMap(item => item?.check_runs ?? []), ...(workflowPending ? { workflowPending } : {}) };
}
