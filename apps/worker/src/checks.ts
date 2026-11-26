import { checksPassed, isInternalReviewAuthor, type ReviewDecision } from './core.ts';
import { progressCheckName } from './review-progress.ts';
import { githubRequest } from './github-request.ts';
export type Check = { id?: number; name: string; status: string; conclusion: string | null; app?: { id: number }; check_suite?: { id: number } };
export type CheckEvidence = { total_count?: number; check_runs: Check[]; workflowPending?: boolean };
type WorkflowRun = {
  workflow_id: number; run_number: number; check_suite_id: number; head_sha: string;
  event: string; status: string; conclusion: string | null;
  pull_requests: { number: number; base?: { sha: string }; head?: { sha: string } }[];
  referenced_workflows?: { path: string; ref: string; sha: string }[];
  head_branch?: string; head_repository?: { id: number } | null;
};
type WorkflowRuns = { total_count: number; workflow_runs: WorkflowRun[] };
export type ReviewCheckHead = { sha: string; ref?: string; repo?: { id: number; owner?: { login: string } } | null };
type PullSource = {
  head: ReviewCheckHead;
  merge?: string | null;
  readPulls: (path: string) => Promise<{ number: number; head: ReviewCheckHead }[] | null>;
};
const actionsApp = 15368;
const aggregateVerify = /^(?:CI \/ )?verify$/;

const scopedBoundraReviews = new WeakSet<CheckEvidence>();
const boundraRepository = 'Oddmash/boundra';
const boundraRepositoryId = 1218645367;
const boundraCI = 296703178;
const boundraPages = 427973803;
const boundraScopeFiles = {
  workflow: '.github/workflows/boundra.yml',
  classifier: 'scripts/classify-ci-scope.mjs',
  classifierTests: 'scripts/classify-ci-scope.test.mjs',
  pages: '.github/workflows/pages.yml'
} as const;
const boundraScopeContracts = [
  { workflow: '111d1bc79cebd2d8223b7587af35deee4f35f8a3', classifierTests: '44adee98496346c5e154b48d81263f9b5a284949', sharedWorkflow: null },
  { workflow: 'de7b774b19321864a81edc320e0631b10b1fe14b', classifierTests: '186d9a534c56adf5dcd90f94ed14690d85aeeaca', sharedWorkflow: '78fb14cdfa36c2b348f8216369fabc3cd661f4a2' }
] as const;
const sharedScopeWorkflow = '.github/workflows/ci-scope.yml';
const boundraSiteJobs = {
  'scope': 'success', 'contribution / scope': 'success', 'verify': 'success',
  'verify-example': 'skipped', 'verify-runtime': 'skipped', 'verify-cli-platforms': 'skipped',
  'benchmark-smoke': 'skipped', 'release-notes': 'skipped'
} as const;
const boundraScopedProfiles: Readonly<Record<string, string>>[] = [
  boundraSiteJobs,
  ...['skipped', 'success'].flatMap((notes): Readonly<Record<string, string>>[] => [
    {
      scope: 'success', 'contribution / scope': 'success', verify: 'success',
      'verify-example': 'success', 'verify-runtime': 'skipped',
      'verify-cli-platforms (ubuntu-24.04)': 'success', 'verify-cli-platforms (macos-15)': 'success',
      'verify-cli-platforms (macos-15-intel)': 'success', 'verify-cli-platforms (windows-2025)': 'success',
      'benchmark-smoke': 'success', 'release-notes': notes
    },
    {
      scope: 'success', 'contribution / scope': 'success', verify: 'success',
      'verify-example': 'success', 'verify-cli-platforms': 'skipped', 'benchmark-smoke': 'skipped',
      'verify-runtime (20)': 'success', 'verify-runtime (22)': 'success', 'verify-runtime (24)': 'success',
      'release-notes': notes
    }
  ])
];
const boundraPagesJobs = { validate: 'success', deploy: 'skipped' } as const;

const publicJson = <T>(request: typeof fetch, path: string): Promise<T | null> =>
  githubRequest(request, path, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(5000)
  }).then(response => response.ok ? response.json() as Promise<T> : null).catch(() => null);

const suiteMatches = (checks: Check[], suite: number, expected: Readonly<Record<string, string>>, prefix: string) => {
  const jobs = checks.filter(check => check.app?.id === actionsApp && check.check_suite?.id === suite);
  if (jobs.length !== Object.keys(expected).length) return false;
  return Object.entries(expected).every(([name, conclusion]) =>
    jobs.filter(job => (job.name === name || job.name === prefix + ' / ' + name) && job.status === 'completed' && job.conclusion === conclusion).length === 1);
};

async function verifiedBoundraScope(root: string, number: number, sha: string, evidence: CheckEvidence, request: typeof fetch, source?: PullSource): Promise<boolean> {
  if (root !== '/repos/' + boundraRepository || !source || source.head.repo?.id !== boundraRepositoryId ||
      source.head.repo.owner?.login !== 'Oddmash' || !source.head.ref || !source.merge || !/^[a-f0-9]{40}$/.test(source.merge) ||
      !/^[a-f0-9]{40}$/.test(source.head.sha) || ![source.head.sha, source.merge].includes(sha) ||
      evidence.workflowPending || evidence.total_count !== evidence.check_runs.length) return false;
  const suites = [...new Set(evidence.check_runs.flatMap(check =>
    check.app?.id === actionsApp && Number.isSafeInteger(check.check_suite?.id) && check.check_suite!.id > 0 ? [check.check_suite!.id] : []))];
  const ci = suites.filter(suite => boundraScopedProfiles.some(profile => suiteMatches(evidence.check_runs, suite, profile, 'CI')));
  const pages = suites.filter(suite => suiteMatches(evidence.check_runs, suite, boundraPagesJobs, 'Deploy Pages'));
  if (!ci.length) return false;
  const runs = await publicJson<WorkflowRuns>(request, root + '/actions/runs?head_sha=' + source.head.sha + '&per_page=100');
  if (!Array.isArray(runs?.workflow_runs) || runs.total_count !== runs.workflow_runs.length) return false;
  const latestSuiteRun = (workflow: number, candidates: number[]) => {
    const related = runs.workflow_runs.filter(run => run.workflow_id === workflow && run.head_sha === source.head.sha && run.event === 'pull_request');
    if (!related.length || related.some(run => !Number.isSafeInteger(run.run_number) || run.pull_requests?.length !== 1 ||
      run.pull_requests[0].number !== number || run.head_repository?.id !== boundraRepositoryId || run.head_branch !== source.head.ref)) return null;
    const latest = Math.max(...related.map(run => run.run_number));
    const [current, duplicate] = related.filter(run => run.run_number === latest);
    return current && !duplicate && candidates.includes(current.check_suite_id) && current.status === 'completed' && current.conclusion === 'success' ? current : null;
  };
  const ciRun = latestSuiteRun(boundraCI, ci);
  const pagesRun = latestSuiteRun(boundraPages, pages);
  if (!ciRun) return false;
  const hasPagesRun = runs.workflow_runs.some(run =>
    run.workflow_id === boundraPages && run.head_sha === source.head.sha && run.event === 'pull_request');
  if (hasPagesRun && !pagesRun) return false;

  const readBlob = (path: string) =>
    publicJson<{ type?: string; sha?: string }>(request, root + '/contents/' + path + '?ref=' + source.merge);
  const [mergeCommit, workflow, classifier, classifierTests, pagesWorkflow] = await Promise.all([
    publicJson<{ parents?: { sha: string }[] }>(request, root + '/git/commits/' + source.merge),
    readBlob(boundraScopeFiles.workflow),
    readBlob(boundraScopeFiles.classifier),
    readBlob(boundraScopeFiles.classifierTests),
    readBlob(boundraScopeFiles.pages)
  ]);
  const parents = mergeCommit?.parents;
  const base = parents?.[0]?.sha;
  if (parents?.length !== 2 || !base || !/^[a-f0-9]{40}$/.test(base) || parents[1]?.sha !== source.head.sha ||
      [ciRun, pagesRun].some(run => run && (run.pull_requests[0].base?.sha !== base || run.pull_requests[0].head?.sha !== source.head.sha))) return false;

  if ([workflow, classifier, classifierTests, pagesWorkflow].some(item => item?.type !== 'file') ||
      classifier?.sha !== '4f941d29489a3fc007e9285f87b4d6a369e441b2' || pagesWorkflow?.sha !== '3bb95fdf641880ada87f4bf2eadcd602886ccf88') return false;
  const contract = boundraScopeContracts.find(item => item.workflow === workflow?.sha && item.classifierTests === classifierTests?.sha);
  if (!contract) return false;
  if (!pagesRun) {
    const comparison = await publicJson<{ status?: string; merge_base_commit?: { sha: string }; files?: { filename: string; status: string }[] }>(
      request, root + '/compare/' + base + '...' + source.merge + '?per_page=1'
    );
    // Boundra's Pages workflow intentionally does not run for a root guidance edit.
    if (comparison?.status !== 'ahead' || comparison.merge_base_commit?.sha !== base || comparison.files?.length !== 1 ||
        comparison.files[0]?.filename !== 'AGENTS.md' || comparison.files[0]?.status !== 'modified') return false;
  }
  if (!contract.sharedWorkflow) return true;

  // The workflow run records the immutable revision actually used by its ci-v1 call.
  if (!Array.isArray(ciRun.referenced_workflows)) return false;
  const [shared, extra] = ciRun.referenced_workflows;
  if (!shared || extra || shared.path !== 'Oddmash/.github/' + sharedScopeWorkflow + '@ci-v1' ||
      shared.ref !== 'refs/heads/ci-v1' || !/^[a-f0-9]{40}$/.test(shared.sha)) return false;
  const sharedFile = await publicJson<{ type?: string; sha?: string }>(
    request, '/repos/Oddmash/.github/contents/' + sharedScopeWorkflow + '?ref=' + shared.sha
  );
  return sharedFile?.type === 'file' && sharedFile.sha === contract.sharedWorkflow;
}

export function reviewChecksAreScopedAdvisory(evidence: CheckEvidence, repository?: string): boolean {
  return repository === boundraRepository && scopedBoundraReviews.has(evidence) &&
    !evidence.workflowPending && evidence.total_count === evidence.check_runs.length && checksPassed(evidence.check_runs);
}

export function reviewChecksMayStart(evidence: CheckEvidence, repository?: string): boolean {
  return reviewChecksSuccessful(evidence, repository) || reviewChecksAreScopedAdvisory(evidence, repository);
}

export const scopedAdvisoryNote = (evidence: CheckEvidence, repository?: string): string =>
  reviewChecksAreScopedAdvisory(evidence, repository)
    ? '\n\nApplicable CI scope verified against the pinned workflow contract. This is an advisory review only; full-matrix approval and automatic merge remain unavailable.'
    : '';


export function publicReviewCheckReader(root: string, number: number, read: (sha: string) => Promise<CheckEvidence | null>, request: typeof fetch = fetch, source?: PullSource) {
  return async (sha: string): Promise<CheckEvidence | null> => {
    const evidence = await read(sha);
    if (!evidence || evidence.total_count !== evidence.check_runs.length) return evidence;
    const actions = evidence.check_runs.filter(check => check.app?.id === actionsApp && check.check_suite?.id);
    const candidates = actions.filter(check => check.status === 'completed' && ['cancelled', 'failure'].includes(check.conclusion ?? ''));
    if (!candidates.length) {
      if (!await verifiedBoundraScope(root, number, sha, evidence, request, source)) return evidence;
      const scoped = { ...evidence };
      scopedBoundraReviews.add(scoped);
      return scoped;
    }

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
    const result = { total_count: check_runs.length, check_runs, ...(workflowPending ? { workflowPending } : {}) };
    if (await verifiedBoundraScope(root, number, sha, result, request, source)) scopedBoundraReviews.add(result);
    return result;
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
  return queueEnabled && expectedHead === head && /^[a-f0-9]{40}$/i.test(head) && !reviewChecksReady(evidence, repository) && !reviewChecksAreScopedAdvisory(evidence, repository);
}

export function finalReviewEvent(assessment: ReviewDecision, evidence: CheckEvidence, repository?: string, author?: { id: number; login: string }): Exclude<ReviewDecision, 'REQUEST_CHANGES'> | null {
  if (reviewChecksAreScopedAdvisory(evidence, repository)) return 'COMMENT';
  if (!reviewChecksReady(evidence, repository)) return null;
  if (assessment === 'REQUEST_CHANGES') return 'COMMENT';
  if (!reviewChecksSuccessful(evidence, repository)) return null;
  return assessment === 'APPROVE' && !isInternalReviewAuthor(author) ? 'COMMENT' : assessment;
}

export async function loadCheckEvidence(head: string, merge: string | null | undefined, read: (sha: string) => Promise<CheckEvidence | null>, reviewerAppId = Number(process.env.REVIEWER_APP_ID)): Promise<CheckEvidence> {
  const refs = [head];
  if (merge && /^[a-f0-9]{40}$/i.test(merge) && merge !== head) refs.push(merge);
  const rawEvidence = await Promise.all(refs.map(read));
  const evidence = rawEvidence.map(item => {
    if (!item || !Number.isSafeInteger(reviewerAppId) || reviewerAppId <= 0) return item;
    const check_runs = item.check_runs.filter(check => check.name !== progressCheckName || check.app?.id !== reviewerAppId);
    const filtered = { ...item, check_runs, total_count: (item.total_count ?? item.check_runs.length) - (item.check_runs.length - check_runs.length) };
    if (scopedBoundraReviews.has(item)) scopedBoundraReviews.add(filtered);
    return filtered;
  });
  if (evidence.some(item => item === null)) return { check_runs: evidence.flatMap(item => item?.check_runs ?? []) };
  const workflowPending = evidence.some(item => item?.workflowPending);
  const combined = { total_count: evidence.reduce((sum, item) => sum + (item?.total_count ?? item?.check_runs.length ?? 0), 0), check_runs: evidence.flatMap(item => item?.check_runs ?? []), ...(workflowPending ? { workflowPending } : {}) };
  if (rawEvidence.every(item => item && item.total_count === item.check_runs.length) && evidence.some(item => item && scopedBoundraReviews.has(item))) scopedBoundraReviews.add(combined);
  return combined;
}
