import type { AgentRole } from '@oddmash/agent-operator-contract';

export type ContributorReview = { role: AgentRole; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'; currentHead: boolean; submittedAt: string; id: number };
export type WorkflowFailure = { job: string; step?: string; conclusion: string; jobId: number };
export type ContributorWorkflow = { state: 'action-required' | 'waiting' | 'running' | 'failed' | 'reported' | 'unknown'; id?: number; attempt?: number; name?: string; conclusion?: string; failures?: WorkflowFailure[] };
export type ContributorReviewStatus = { state: 'failed' | 'completed'; id: number; updatedAt: string; reason?: 'checks-failed' };
export type ContributorEvidence = { reviews: ContributorReview[]; reviewsComplete: boolean; reviewStatus?: ContributorReviewStatus; workflow: ContributorWorkflow; observedAt: string };
export type ContributorPull = { repository: string; number: number; title: string; author: string; updatedAt: string; draft: boolean | null; evidence?: ContributorEvidence };
export type ContributorSnapshot = { pulls: ContributorPull[]; observedAt: string; partial: boolean };

const externalAssociations = new Set(['CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'NONE']);
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function parseContributorPulls(payload: unknown, ownerId: string, observedAt: string): ContributorSnapshot {
  const data = record(payload);
  if (!data || !Array.isArray(data.items) || typeof data.total_count !== 'number' || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || typeof data.incomplete_results !== 'boolean') throw new Error('Invalid public search response');
  const pulls: ContributorPull[] = [];
  let partial = data.incomplete_results || data.total_count > data.items.length || data.items.length > 100;
  for (const item of data.items.slice(0, 100)) {
    const row = record(item);
    const user = record(row?.user);
    if (!row || !user || !record(row.pull_request)) { partial = true; continue; }
    if (row.state !== 'open' || user.type !== 'User' || String(user.id) === ownerId || typeof row.author_association !== 'string' || !externalAssociations.has(row.author_association)) continue;
    const repository = typeof row.repository_url === 'string' ? /^https:\/\/api\.github\.com\/repos\/(Oddmash\/[A-Za-z0-9_.-]+)$/i.exec(row.repository_url)?.[1] : undefined;
    if (!repository || typeof row.number !== 'number' || !Number.isSafeInteger(row.number) || row.number < 1 || typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || typeof row.title !== 'string' || typeof user.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(user.login) || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) { partial = true; continue; }
    pulls.push({ repository, number: row.number, title: row.title.slice(0, 300), author: user.login, updatedAt: row.updated_at, draft: typeof row.draft === 'boolean' ? row.draft : null });
  }
  return { pulls, observedAt, partial };
}

const botRoles = new Map<number, AgentRole>([[360059368,'reviewer'],[360494540,'impact'],[360494749,'qa'],[360494807,'release'],[360494869,'docs'],[360494928,'architect']]);
const states = new Set(['APPROVED','CHANGES_REQUESTED','COMMENTED','DISMISSED']);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const shaPattern = /^[a-f0-9]{40}$/i;
type PullHead = { sha: string; repositoryId: number; branch: string };
export function parseReviewEvidence(payload: unknown, sha: string): ContributorReview[] {
  if (!Array.isArray(payload)) throw new Error('Invalid reviews');
  const latest = new Map<AgentRole, ContributorReview>();
  for (const raw of payload) {
    const row = record(raw), user = record(row?.user);
    const role = typeof user?.id === 'number' && user.type === 'Bot' ? botRoles.get(user.id) : undefined;
    if (!role || !row || typeof row.state !== 'string' || !states.has(row.state) || !positiveId(row.id) || typeof row.submitted_at !== 'string' || !Number.isFinite(Date.parse(row.submitted_at))) continue;
    const item: ContributorReview = { role, state: row.state as ContributorReview['state'], currentHead: row.commit_id === sha, submittedAt: row.submitted_at, id: row.id };
    const previous = latest.get(role);
    if (!previous || Date.parse(item.submittedAt) >= Date.parse(previous.submittedAt)) latest.set(role, item);
  }
  return [...latest.values()];
}
export function parseWorkflowEvidence(payload: unknown, head: PullHead, number: number): ContributorWorkflow {
  const data = record(payload);
  if (!data || !Array.isArray(data.workflow_runs) || !Number.isSafeInteger(data.total_count) || Number(data.total_count) < 0) throw new Error('Invalid workflows');
  const associated = data.workflow_runs.map(record).filter(run => {
    if (!run || run.event !== 'pull_request' || run.head_sha !== head.sha || !positiveId(run.id)) return false;
    const prs = run.pull_requests;
    if (Array.isArray(prs) && prs.length) return prs.some(pr => record(pr)?.number === number);
    return record(run.head_repository)?.id === head.repositoryId && run.head_branch === head.branch;
  });
  const newest = new Map<number, Record<string, unknown>>();
  for (const run of associated) {
    if (!run || !positiveId(run.id)) continue;
    const key = positiveId(run.workflow_id) ? run.workflow_id : run.id;
    const previous = newest.get(key);
    if (!previous || Number(run.id) > Number(previous.id) || (run.id === previous.id && Number(run.run_attempt ?? 0) > Number(previous.run_attempt ?? 0))) newest.set(key, run);
  }
  const matches = [...newest.values()];
  const describe = (run: Record<string, unknown>, state: ContributorWorkflow['state']): ContributorWorkflow => ({ state, id: run.id as number, ...(positiveId(run.run_attempt) ? {attempt:run.run_attempt} : {}), ...(typeof run.name === 'string' ? {name:run.name.slice(0,160)} : {}), ...(typeof run.conclusion === 'string' && ['failure','timed_out','cancelled','startup_failure','action_required'].includes(run.conclusion) && state === 'failed' ? {conclusion:run.conclusion} : {}) });
  const actionable = matches.find(run => run?.status === 'action_required' || run?.conclusion === 'action_required');
  if (actionable) return describe(actionable,'action-required');
  const waiting = matches.find(run => run?.status === 'waiting');
  if (waiting) return describe(waiting,'waiting');
  const running = matches.find(run => run?.status === 'in_progress' || run?.status === 'queued' || run?.status === 'requested' || run?.status === 'pending');
  if (running) return describe(running,'running');
  const failed = matches.find(run => run.status === 'completed' && ['failure','timed_out','cancelled','startup_failure'].includes(String(run.conclusion)));
  if (failed) return describe(failed,'failed');
  return { state: matches.length && Number(data.total_count) <= data.workflow_runs.length ? 'reported' : 'unknown' };
}
export function parseWorkflowFailures(payload: unknown, runId: number): WorkflowFailure[] {
  const data = record(payload);
  if (!data || !Array.isArray(data.jobs)) throw new Error('Invalid jobs');
  const failed = new Set(['failure','timed_out','cancelled','action_required','startup_failure']);
  return data.jobs.slice(0,100).flatMap(raw => {
    const job = record(raw);
    if (!job || job.run_id !== runId || !positiveId(job.id) || typeof job.name !== 'string' || typeof job.conclusion !== 'string' || !failed.has(job.conclusion)) return [];
    const step = Array.isArray(job.steps) ? job.steps.map(record).find(s => typeof s?.conclusion === 'string' && failed.has(s.conclusion)) : undefined;
    return [{job:job.name.slice(0,160), jobId:job.id, conclusion:job.conclusion, ...(typeof step?.name === 'string' ? {step:step.name.slice(0,160)} : {})}];
  }).slice(0,8);
}
export function parseReviewStatus(payload: unknown, sha: string): ContributorReviewStatus | undefined {
  if (!Array.isArray(payload)) throw new Error('Invalid comments');
  let latest: ContributorReviewStatus | undefined;
  for (const raw of payload) {
    const item = record(raw), user = record(item?.user);
    if (user?.id !== 360059368 || user.type !== 'Bot' || !item || !positiveId(item.id) || typeof item.body !== 'string' || typeof item.updated_at !== 'string' || !Number.isFinite(Date.parse(item.updated_at))) continue;
    if (!item.body.startsWith('<!-- oddmash-automation-status:review -->\n') || !item.body.includes('Commit: `'+sha.slice(0,12)+'`')) continue;
    const state = item.body.startsWith('<!-- oddmash-automation-status:review -->\n**Review processing failed**') ? 'failed' : item.body.startsWith('<!-- oddmash-automation-status:review -->\n**Completed**') ? 'completed' : undefined;
    if (!state) continue;
    const result: ContributorReviewStatus = {state,id:item.id,updatedAt:item.updated_at,...(item.body.includes('Required CI checks did not pass.') ? {reason:'checks-failed' as const} : {})};
    if (!latest || Date.parse(result.updatedAt) > Date.parse(latest.updatedAt)) latest = result;
  }
  return latest;
}
const headers = { Accept:'application/vnd.github+json', 'User-Agent':'Oddmash-Console', 'X-GitHub-Api-Version':'2022-11-28' };
const publicReadTimes: number[] = [];
const readPublic = async (request: typeof fetch, url: string, signal: AbortSignal) => {
  const now = Date.now();
  while (publicReadTimes.length && publicReadTimes[0] <= now - 60 * 60_000) publicReadTimes.shift();
  if (publicReadTimes.length >= 50) throw new Error('Public observation budget exhausted');
  publicReadTimes.push(now);
  const response = await request(url, { headers, redirect:'error', signal });
  if (!response.ok) throw new Error('Public evidence unavailable');
  return response;
};
const readEvidence = async (pull: ContributorPull, request: typeof fetch, signal: AbortSignal): Promise<ContributorEvidence> => {
  const evidence: ContributorEvidence = {reviews:[], reviewsComplete:false, workflow:{state:'unknown'}, observedAt:new Date().toISOString()};
  const root = 'https://api.github.com/repos/' + pull.repository;
  try {
    const detail = record(await (await readPublic(request, root + '/pulls/' + pull.number, signal)).json());
    const head = record(detail?.head), source = record(head?.repo), base = record(record(detail?.base)?.repo);
    if (detail?.number !== pull.number || typeof base?.full_name !== 'string' || base.full_name.toLowerCase() !== pull.repository.toLowerCase() || base?.private !== false || typeof head?.sha !== 'string' || !shaPattern.test(head.sha) || !positiveId(source?.id) || typeof head.ref !== 'string') return evidence;
    const revision = {sha:head.sha, repositoryId:source.id, branch:head.ref};
    await Promise.allSettled([
      (async () => {
        const response = await readPublic(request, root + '/pulls/' + pull.number + '/reviews?per_page=100', signal);
        const payload = await response.json();
        evidence.reviews = parseReviewEvidence(payload, revision.sha);
        evidence.reviewsComplete = Array.isArray(payload) && payload.length < 100 && !response.headers.get('link')?.includes('rel="next"');
      })(),
      (async () => {
        const response = await readPublic(request, root + '/actions/runs?event=pull_request&head_sha=' + revision.sha + '&per_page=100', signal);
        evidence.workflow = parseWorkflowEvidence(await response.json(), revision, pull.number);
        const workflow = evidence.workflow;
        if (workflow.state === 'failed' && workflow.id) {
          const attemptPath = workflow.attempt ? '/attempts/' + workflow.attempt : '';
          const jobs = await readPublic(request, root + '/actions/runs/' + workflow.id + attemptPath + '/jobs?per_page=100', signal);
          workflow.failures = parseWorkflowFailures(await jobs.json(), workflow.id);
        }
      })(),
      (async () => {
        const response = await readPublic(request, root + '/issues/' + pull.number + '/comments?per_page=100', signal);
        evidence.reviewStatus = parseReviewStatus(await response.json(), revision.sha);
      })()
    ]);
  } catch {}
  return evidence;
};
let cached: { owner: string; expires: number; value: ContributorSnapshot } | undefined;
let pending: { owner: string; promise: Promise<ContributorSnapshot> } | undefined;
export async function readContributorPulls(owner: string, request: typeof fetch = fetch): Promise<ContributorSnapshot> {
  if (!/^[1-9]\d*$/.test(owner)) throw new Error('Missing owner');
  if (cached?.owner === owner && cached.expires > Date.now()) return cached.value;
  if (pending?.owner === owner) return pending.promise;
  const promise = (async () => {
    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', 'org:Oddmash is:pr is:open is:public');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', '100');
    let response: Response;
    try { response = await readPublic(request, url.toString(), AbortSignal.timeout(6000)); }
    catch (error) {
      if (cached?.owner !== owner) throw error;
      return { ...cached.value, partial: true, pulls: cached.value.pulls.map(({evidence: _evidence, ...pull}) => pull) };
    }
    const value = parseContributorPulls(await response.json(), owner, new Date().toISOString());
    const signal = AbortSignal.timeout(6000);
    const detailed = value.pulls.slice(0, 4);
    await Promise.all(detailed.map(async pull => { pull.evidence = await readEvidence(pull, request, signal); }));
    cached = { owner, expires: Date.now() + 60_000, value };
    return value;
  })();
  pending = { owner, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}
