import type { AgentRole } from '@oddmash/agent-operator-contract';

export type ContributorReview = { role: AgentRole; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'; currentHead: boolean; submittedAt: string; id: number };
export type ContributorWorkflow = { state: 'action-required' | 'waiting' | 'running' | 'failed' | 'reported' | 'unknown'; id?: number };
export type ContributorEvidence = { reviews: ContributorReview[]; reviewsComplete: boolean; workflow: ContributorWorkflow; observedAt: string };
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
    if (!previous || Number(run.id) > Number(previous.id)) newest.set(key, run);
  }
  const matches = [...newest.values()];
  const actionable = matches.find(run => run?.status === 'action_required' || run?.conclusion === 'action_required');
  if (actionable) return { state:'action-required', id: actionable.id as number };
  const waiting = matches.find(run => run?.status === 'waiting');
  if (waiting) return { state:'waiting', id: waiting.id as number };
  const running = matches.find(run => run?.status === 'in_progress' || run?.status === 'queued' || run?.status === 'requested' || run?.status === 'pending');
  if (running) return { state:'running', id: running.id as number };
  const failed = matches.find(run => run.status === 'completed' && ['failure','timed_out','cancelled'].includes(String(run.conclusion)));
  if (failed) return { state:'failed', id:failed.id as number };
  return { state: matches.length && Number(data.total_count) <= data.workflow_runs.length ? 'reported' : 'unknown' };
}
const headers = { Accept:'application/vnd.github+json', 'User-Agent':'Oddmash-Console', 'X-GitHub-Api-Version':'2022-11-28' };
const readPublic = async (request: typeof fetch, url: string, signal: AbortSignal) => {
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
    const response = await request(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Oddmash-Console', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Public search unavailable');
    const value = parseContributorPulls(await response.json(), owner, new Date().toISOString());
    const signal = AbortSignal.timeout(6000);
    const detailed = value.pulls.slice(0, 4);
    await Promise.all(detailed.map(async pull => { pull.evidence = await readEvidence(pull, request, signal); }));
    cached = { owner, expires: Date.now() + 15 * 60_000, value };
    return value;
  })();
  pending = { owner, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}
