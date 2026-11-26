import { createHash } from 'node:crypto';
import { addedLines, isInternalReviewAuthor, isOwner, patchComplete, safeText, privateSensitiveText, selectFiles, type ChangedFile } from './core.ts';
import { loadCheckEvidence, reviewChecksSuccessful, type CheckEvidence } from './checks.ts';
import { githubApi, mergeRepositoryAllowed, type Target } from './webhook.ts';

const sha = /^[a-f0-9]{40}$/i;
type Api = ReturnType<typeof githubApi>;
type Identity = { id: number; login: string };
export type MergePull = { number: number; state: string; draft: boolean; user: Identity; body: string | null; changed_files: number; mergeable: boolean | null; mergeable_state: string; merge_commit_sha?: string | null; head: { sha: string; ref?: string; repo: { id: number; full_name: string } | null }; base: { sha: string; ref: string; repo: { id: number; private: boolean; full_name: string; default_branch: string; archived?: boolean; allow_merge_commit?: boolean } }; labels: { name: string }[] };
type Issue = { number: number; state: string; body: string | null; user: Identity; pull_request?: unknown; updated_at: string };
type Branch = { protected: boolean; commit: { sha: string }; protection?: { enabled: boolean; required_status_checks?: { enforcement_level: string; checks?: { context: string; app_id: number }[] } } };
type Review = { id: number; user: Identity; state: string; commit_id: string; body: string | null };
export type Acceptance = { issue: number; digest: string; body: string; criteria: string[]; mode?: 'partial'; scope?: string };
export type Candidate = { pull: MergePull; acceptance: Acceptance; repositoryOptIn?: 'documentation' };
export function mergeProof(candidate: Candidate): string {
  const { pull, acceptance } = candidate;
  const digest = createHash('sha256').update(JSON.stringify([pull.base.repo.id, pull.number, pull.base.ref, pull.head.sha, pull.base.sha, pull.merge_commit_sha, acceptance.digest, ...(candidate.repositoryOptIn ? [candidate.repositoryOptIn] : [])])).digest('hex');
  return `<!-- oddmash-merge-proof:${digest} -->`;
}

export function eligiblePull(pr: MergePull, target: Target): boolean {
  if (infrastructureRepositories.has(target.repository) && pr.base.ref !== 'main') return false;
  return mergeRepositoryAllowed(target) && isInternalReviewAuthor(pr.user) && pr.state === 'open' && !pr.draft && pr.base.repo.private === Boolean(target.private) && !pr.base.repo.archived && pr.base.repo.allow_merge_commit !== false && pr.base.repo.id === target.repositoryId && pr.base.repo.full_name === target.repository && pr.head.repo?.id === target.repositoryId && pr.head.repo.full_name === target.repository && (pr.base.ref === 'develop' || (pr.base.ref === 'main' && pr.base.repo.default_branch === 'main')) && sha.test(pr.head.sha) && sha.test(pr.base.sha) && sha.test(pr.merge_commit_sha ?? '') && pr.changed_files > 0 && pr.changed_files <= 20 && !pr.labels.some(l => /(?:^|: )(?:no auto.merge|do not merge|manual|blocked|hold|wip)$/i.test(l.name));
}

export function ineligiblePullReason(pr: MergePull, target: Target): string {
  if (!mergeRepositoryAllowed(target)) return 'repository is outside the auto-merge allowlist';
  if (infrastructureRepositories.has(target.repository) && pr.base.ref !== 'main') return 'infrastructure PR must target main';
  if (!isInternalReviewAuthor(pr.user)) return 'PR author is not an authorized internal contributor';
  if (pr.state !== 'open' || pr.draft) return 'pull request is not open and ready';
  if (pr.base.repo.private !== Boolean(target.private) || pr.base.repo.archived) return 'repository visibility or archive state is ineligible';
  if (pr.base.repo.id !== target.repositoryId || pr.base.repo.full_name !== target.repository) return 'base repository identity is ineligible';
  if (pr.base.repo.allow_merge_commit === false) return 'normal merge commits are disabled';
  if (pr.head.repo?.id !== target.repositoryId || pr.head.repo.full_name !== target.repository) return 'fork or source repository mismatch';
  if (pr.base.ref !== 'develop' && (pr.base.ref !== 'main' || pr.base.repo.default_branch !== 'main')) return 'target is neither develop nor the default main branch';
  if (pr.changed_files > 20 || pr.changed_files < 1) return 'changed-file count exceeds the auto-merge budget';
  if (!sha.test(pr.head.sha) || !sha.test(pr.base.sha)) return 'current head or base commit evidence is incomplete';
  if (!sha.test(pr.merge_commit_sha ?? '')) return 'merge commit evidence is not ready';
  if (pr.labels.some(l => /(?:^|: )(?:no auto.merge|do not merge|manual|blocked|hold|wip)$/i.test(l.name))) return 'pull request has manual hold label';
  return 'PR state, repository identity, merge method, or manual hold is ineligible';
}

const infrastructureRepositories = new Set(['Oddmash/oddmash-agents', 'Oddmash/oddmash-skills', 'Oddmash/.github']);
export const repositoryMergeProperty = 'oddmash-auto-merge';

export async function repositoryMergeOptIn(api: Api, repository: string): Promise<'not-required' | 'documentation' | 'disabled' | 'unavailable'> {
  if (!infrastructureRepositories.has(repository)) return 'not-required';
  try {
    const values = await api<unknown>(`/repos/${repository}/properties/values`);
    if (!Array.isArray(values)) return 'unavailable';
    const matching = values.filter(item => item && typeof item === 'object' && item.property_name === repositoryMergeProperty);
    if (matching.length !== 1) return 'disabled';
    return matching[0].value === 'documentation' ? 'documentation' : 'disabled';
  } catch { return 'unavailable'; }
}

const sourceRoots: Record<string, RegExp> = {
  'Oddmash/juliya': /^(?:src|site\/(?:app|components|lib))\//,
  'Oddmash/oddmash-ui': /^(?:src|demo)\//,
  'Oddmash/interaction-inspector': /^(?:src|demo)\//,
  'Oddmash/Vertactics': /^apps\/(?:editor\/src|landing\/app)\//,
  'Oddmash/boundra': /^packages\/(?:runtime|ui)\/src\//,
  'Oddmash/oddmash-mobile': /^(?:src|demo)\//,
  'Oddmash/oddmash-website': /^dist\/(?:[^/]+)$/,
};
const testRoots: Record<string, RegExp> = {
  'Oddmash/juliya': /^(?:test|site\/test)\//,
  'Oddmash/oddmash-ui': /^tests\//,
  'Oddmash/interaction-inspector': /^tests\//,
  'Oddmash/Vertactics': /^apps\/editor\/tests\//,
  'Oddmash/boundra': /^packages\/(?:runtime|ui)\/tests\//,
  'Oddmash/oddmash-mobile': /^tests\//,
};

export function lowRiskReason(files: ChangedFile[], count: number, repository = '', optIn?: 'documentation'): string | undefined {
  if (count < 1 || count > 20) return 'changed-file count exceeds the auto-merge budget';
  if (!files.length || files.length !== count) return 'changed-file list is incomplete';
  if (files.reduce((size, file) => size + (file.patch?.length ?? 0), 0) > 45_000) return 'changed diff exceeds the auto-merge budget';
  if (['Oddmash/oddmash-agents', 'Oddmash/oddmash-skills'].includes(repository)) {
    const pathAllowed = optIn === 'documentation' ? /^(?:README(?:\.[a-z-]+)?\.md|docs\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.md)$/i : /^README(?:\.[a-z-]+)?\.md$/i;
    if (files.some(file => !pathAllowed.test(file.filename))) return optIn === 'documentation' ? 'infrastructure documentation opt-in excludes runtime changes' : 'repository requires root README-only changes';
  }
  for (const f of files) {
    const path = f.filename;
    if (!f.patch || !patchComplete(f)) return 'changed diff evidence is incomplete';
    if (!['added', 'modified'].includes(f.status) || f.previous_filename) return 'changed file operation requires manual merge';
    if (safeText(f.patch) !== f.patch) return 'changed content requires confidential manual review';
    if (repository === 'Oddmash/.github') {
      if (optIn !== 'documentation') return 'repository automatic merge opt-in is not enabled';
      if (!/^(?:AGENTS\.md|CONTRIBUTING\.md|PULL_REQUEST_TEMPLATE\.md|profile\/README\.md|docs\/(?:ko|ja|zh-CN)\/(?:README|CONTRIBUTING)\.md|\.github\/ISSUE_TEMPLATE\/(?:bug_report_en|chore|documentation|feature|fix|improvement|refactor|test)\.md)$/.test(path)) return 'protected changed path requires manual merge';
      continue;
    }
    if (/(?:policy|release|deploy|security|auth|architecture|credential|instructions|review|config|permission|secret|token|generated|background|service.worker|storage|migration)/i.test(path) || /(?:^|\/)(?:AGENTS\.md|CONTRIBUTING\.md|SECURITY\.md|CODEOWNERS|PROMPT\.md|SPEC\.md|CHANGELOG\.md|\.github|scripts)(?:\/|$)/i.test(path)) return 'protected changed path requires manual merge';
    if (/^(?:README(?:\.[a-z-]+)?\.md|docs\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.md)$/i.test(path)) continue;
    const isTest = testRoots[repository]?.test(path) || /(?:\.test\.|\.spec\.|(?:^|\/)(?:tests?|__tests__)\/)/.test(path);
    const ext = /\.(?:[cm]?[jt]sx?|css|scss)$/i;
    if (!ext.test(path)) return 'changed file type is outside automatic merge scope';
    if (isTest) {
      if (!(testRoots[repository]?.test(path) || sourceRoots[repository]?.test(path))) return 'changed test path is outside automatic merge scope';
      if (/^-/m.test(f.patch) || /^\+(?!\+).*(?:\b(?:test|it|describe)\.(?:skip|only|todo)|\b(?:skip|todo)\s*:\s*true)/m.test(f.patch)) return 'test changes are not additive and enabled';
      continue;
    }
    if (!sourceRoots[repository]?.test(path)) return 'changed source path is outside automatic merge scope';
  }
}

export function lowRisk(files: ChangedFile[], count: number, repository = ''): boolean {
  return lowRiskReason(files, count, repository) === undefined;
}

const standaloneReferences = (body: string) => body.split(/\r?\n/).flatMap(line => {
  const match = /^(?:[-*+]\s+)?(refs|closes)\s+((?:[a-z0-9_.-]+\/[a-z0-9_.-]+)?#([1-9]\d*))\.?$/i.exec(line.trim());
  return match ? [match] : [];
});

export function crossRepositoryIssueReference(body: string | null): string | undefined {
  if (!body || body.length > 12_000 || body.includes('```')) return;
  const links = standaloneReferences(body);
  const reference = links.length === 1 ? links[0][2] : undefined;
  if (reference && !reference.startsWith('#') && reference.length <= 160) return reference;
}

export function linkedIssueReference(body: string | null): { number: number; mode: 'closing' | 'partial' } | null {
  const text = body ?? '';
  if (text.length > 12000 || /\x60\x60\x60/.test(text)) return null;
  const links = standaloneReferences(text);
  const references = [...text.matchAll(/\b(?:refs?|references?|close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+(?:#|[a-z0-9_.-]+\/|https?:\/\/)/gi)];
  if (links.length !== 1 || references.length !== 1 || !links[0][2].startsWith('#')) return null;
  const number = Number(links[0][3]);
  return Number.isSafeInteger(number) ? { number, mode: links[0][1].toLowerCase() === 'refs' ? 'partial' : 'closing' } : null;
}

export function linkedIssue(body: string | null): number | null {
  return linkedIssueReference(body)?.number ?? null;
}

const acceptanceBullet = (line: string) => line.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.+)$/)?.[1]?.trim();
const validCriterion = (value: string | undefined) => Boolean(value && value.length >= 12 && value.length <= 500 && !/^(?:tbd|todo|placeholder|fill me in|none|n\/a|not applicable)[.!]?$/i.test(value));

export function acceptanceOf(issue: Issue, privateReview = false): Acceptance | null {
  if (!isOwner(issue.user) || issue.state !== 'open' || issue.pull_request || !issue.body || issue.body.length > 12000 || safeText(issue.body) !== issue.body || (privateReview && privateSensitiveText(issue.body))) return null;
  const sections = issue.body.split(/\r?\n/);
  const start = sections.findIndex(line => /^#{2,3} Acceptance criteria\s*$/i.test(line));
  if (start < 0) return null;
  const end = sections.findIndex((line, index) => index > start && /^#{1,3}\s/.test(line));
  const lines = sections.slice(start + 1, end < 0 ? undefined : end).filter(l => l.trim());
  const criteria = lines.map(acceptanceBullet);
  if (!criteria.length || criteria.length > 8 || criteria.some(c => !validCriterion(c))) return null;
  return { issue: issue.number, digest: createHash('sha256').update(JSON.stringify([issue.number, issue.updated_at, issue.body])).digest('hex'), body: issue.body, criteria: criteria as string[] };
}

export function acceptanceForPull(issue: Issue, pull: MergePull, privateReview = false): Acceptance | null {
  const reference = linkedIssueReference(pull.body);
  const full = acceptanceOf(issue, privateReview);
  if (!reference || !full || reference.number !== issue.number) return null;
  if (reference.mode === 'closing') return pull.base.ref === pull.base.repo.default_branch ? full : null;
  const body = pull.body ?? '';
  if (safeText(body) !== body || (privateReview && privateSensitiveText(body))) return null;
  const sections = body.split(/\r?\n/);
  const explicit = sections.findIndex(line => /^## Acceptance criteria\s*$/i.test(line));
  const start = explicit >= 0 ? explicit : sections.findIndex(line => /^## Summary\s*$/i.test(line));
  if (start < 0) return null;
  const end = sections.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  const lines = sections.slice(start + 1, end < 0 ? undefined : end).filter(line => line.trim());
  const criteria = lines.map(line => explicit >= 0 ? acceptanceBullet(line) : line.replace(/^\s*[-*+]\s+/, '').trim());
  if (!criteria.length || criteria.length > 8 || criteria.some(value => !validCriterion(value))) return null;
  return { ...full, mode: 'partial', scope: body, criteria: criteria as string[], digest: createHash('sha256').update(JSON.stringify([full.digest, 'partial', body])).digest('hex') };
}

export function acceptanceSatisfied(value: unknown, acceptance: Acceptance | undefined, files: ChangedFile[]): boolean {
  if (!acceptance || !Array.isArray(value) || value.length !== acceptance.criteria.length) return false;
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || item.fulfilled !== true || !Number.isInteger(item.criterion) || item.criterion < 0 || item.criterion >= acceptance.criteria.length || seen.has(item.criterion) || typeof item.path !== 'string' || !Number.isInteger(item.line) || typeof item.evidence !== 'string' || !item.evidence.trim() || item.evidence.length > 500 || safeText(item.evidence) !== item.evidence) return false;
    const file = files.find(f => f.filename === item.path);
    if (!file || !addedLines(file.patch ?? '').has(item.line)) return false;
    seen.add(item.criterion);
  }
  return seen.size === acceptance.criteria.length;
}

export async function mergeCandidate(api: Api, target: Target, number: number, withheld: (reason: string) => void = () => {}): Promise<Candidate | null> {
  const deny = (reason: string) => { withheld(reason); return null; };
  const root = '/repos/' + target.repository;
  const pr = await api<MergePull>(root + '/pulls/' + number);
  if (!eligiblePull(pr, target)) return deny(ineligiblePullReason(pr, target));
  const optIn = await repositoryMergeOptIn(api, target.repository);
  if (optIn === 'disabled') return deny('repository automatic merge opt-in is not enabled');
  if (optIn === 'unavailable') return deny('repository automatic merge opt-in is unavailable');
  const issueNumber = linkedIssue(pr.body);
  if (!issueNumber || issueNumber === number) {
    const links = standaloneReferences(pr.body ?? '');
    const distinctLinks = new Set(links.map(link => link[2].toLowerCase()));
    if (pr.head.ref === 'develop' && pr.base.ref === pr.base.repo.default_branch && links.length > 1 && distinctLinks.size === links.length) return deny('multi-issue release requires manual merge');
    if (links.length === 1 && !links[0][2].startsWith('#')) return deny('cross-repository issue reference requires manual merge');
    return deny('missing single issue reference');
  }
  if (pr.base.ref !== pr.base.repo.default_branch && linkedIssueReference(pr.body)?.mode === 'closing') return deny('integration branch requires Refs');
  const issue = await api<Issue>(root + '/issues/' + issueNumber);
  const acceptance = acceptanceForPull(issue, pr, Boolean(target.private));
  if (!acceptance || acceptance.issue !== issueNumber) return deny('issue acceptance criteria are ineligible');
  const files = await api<ChangedFile[]>(root + '/pulls/' + number + '/files?per_page=100');
  const risk = lowRiskReason(files, pr.changed_files, target.repository, optIn === 'documentation' ? optIn : undefined);
  if (risk) return deny(risk);
  if (target.private && selectFiles(files, 45_000, true, 'strict').omitted.length > 0) return deny('private strict review coverage is incomplete');
  return { pull: pr, acceptance, ...(optIn === 'documentation' ? { repositoryOptIn: optIn } : {}) };
}

export function protectedBranch(branch: Branch, base: string): boolean {
  const p = branch.protection;
  return branch.protected === true && branch.commit.sha === base && p?.enabled === true && p.required_status_checks?.enforcement_level === 'everyone' && !!p.required_status_checks.checks?.some(c => c.context === 'verify' && c.app_id === 15368);
}

function matchesMergeRevision(pull: MergePull, candidate: Candidate, target: Target): boolean {
  const original = candidate.pull;
  return eligiblePull(pull, target) && pull.head.sha === original.head.sha &&
    pull.base.ref === original.base.ref && pull.base.sha === original.base.sha &&
    pull.merge_commit_sha === original.merge_commit_sha && linkedIssue(pull.body) === candidate.acceptance.issue;
}

export async function mergeAuthorized(api: Api, target: Target, candidate: Candidate, bot: string, reviewId: number, issueVerified: boolean, mint: () => Promise<Api>, withheld: (reason: string) => void = () => {}): Promise<boolean> {
  const deny = (reason: string) => { withheld(reason); return false; };
  if (!issueVerified) return deny('issue evidence not verified');
  const root = '/repos/' + target.repository;
  const number = candidate.pull.number;
  const current = await mergeCandidate(api, target, number, withheld);
  if (!current) return false;
  if (current.repositoryOptIn !== candidate.repositoryOptIn || current.acceptance.digest !== candidate.acceptance.digest || current.pull.head.sha !== candidate.pull.head.sha || current.pull.base.ref !== candidate.pull.base.ref || current.pull.base.sha !== candidate.pull.base.sha || current.pull.merge_commit_sha !== candidate.pull.merge_commit_sha) return deny('candidate changed');
  if (current.pull.mergeable === null || current.pull.mergeable_state === 'unknown') throw new Error('Mergeability evidence pending');
  // The Mobile branch restricts updates to the maintainer and Lead. The read token
  // can see blocked even though the scoped merge token is an authorized actor.
  const readableMergeability = (pull: MergePull) => pull.mergeable === true &&
    (pull.mergeable_state === 'clean' || (target.repository === 'Oddmash/oddmash-mobile' && pull.mergeable_state === 'blocked'));
  if (!readableMergeability(current.pull)) return deny('candidate is not clean');
  const branch = await api<Branch>(root + '/branches/' + current.pull.base.ref);
  if (!protectedBranch(branch, current.pull.base.sha)) return deny('required branch protection unavailable');
  const compare = await api<{ behind_by: number; merge_base_commit: { sha: string } }>(root + '/compare/' + current.pull.base.sha + '...' + current.pull.head.sha);
  if (compare.behind_by !== 0 || compare.merge_base_commit.sha !== current.pull.base.sha) return deny('branch is not up to date');
  const reviews = await api<Review[]>(root + '/pulls/' + number + '/reviews?per_page=100');
  if (reviews.length >= 100 || !reviews.some(r => r.id === reviewId && r.user.login === bot && r.state === 'APPROVED' && r.commit_id === current.pull.head.sha) || reviews.some(r => r.user.login !== bot && r.commit_id === current.pull.head.sha && r.state === 'COMMENTED' && !!r.body?.trim()) || reviews.some(r => r.state === 'CHANGES_REQUESTED' && !reviews.some(later => later.id > r.id && later.user.id === r.user.id && ['APPROVED', 'DISMISSED'].includes(later.state)))) return deny('exact-head approval or independent review evidence is incomplete');
  const checks = await loadCheckEvidence(current.pull.head.sha, current.pull.merge_commit_sha, ref => api<CheckEvidence>(root + '/commits/' + ref + '/check-runs?per_page=100'));
  if (!reviewChecksSuccessful(checks, target.repository) || !checks.check_runs.some(c => c.name === 'verify' && c.conclusion === 'success' && c.status === 'completed' && c.app?.id === 15368)) return deny('current required check evidence is incomplete');
  for (const ref of [current.pull.head.sha, current.pull.merge_commit_sha!]) {
    const status = await api<{ total_count: number; state: string; statuses: unknown[] }>(root + '/commits/' + ref + '/status');
    if (status.total_count !== status.statuses.length || (status.total_count > 0 && status.state !== 'success')) return deny('commit statuses are incomplete');
  }
  const final = await api<MergePull>(root + '/pulls/' + number);
  if (final.mergeable === null || final.mergeable_state === 'unknown') throw new Error('Mergeability evidence pending');
  if (!matchesMergeRevision(final, current, target) || !readableMergeability(final)) return deny('final PR state changed');
  const finalIssue = acceptanceForPull(await api<Issue>(root + '/issues/' + current.acceptance.issue), final, Boolean(target.private));
  if (!finalIssue || finalIssue.digest !== current.acceptance.digest) return deny('issue changed during review');
  const finalOptIn = await repositoryMergeOptIn(api, target.repository);
  if (finalOptIn === 'disabled') return deny('repository automatic merge opt-in is not enabled');
  if (finalOptIn === 'unavailable') return deny('repository automatic merge opt-in is unavailable');
  if ((finalOptIn === 'documentation' ? finalOptIn : undefined) !== current.repositoryOptIn) return deny('candidate changed');
  const writer = await mint();
  try {
    if (current.pull.mergeable_state === 'blocked' || final.mergeable_state === 'blocked') {
      const authorized = await writer<MergePull>(root + '/pulls/' + number);
      if (authorized.mergeable === null || authorized.mergeable_state === 'unknown') {
        throw new Error('Mergeability evidence pending');
      }
      if (!matchesMergeRevision(authorized, current, target) ||
          authorized.mergeable !== true || authorized.mergeable_state !== 'clean') {
        return deny('candidate is not clean');
      }
    }
    const merged = await writer<{ merged: boolean }>(root + '/pulls/' + number + '/merge', { method: 'PUT', body: JSON.stringify({ sha: final.head.sha, merge_method: 'merge' }) });
    return merged.merged === true || deny('GitHub did not merge the PR');
  } finally {
    try { await writer('/installation/token', { method: 'DELETE' }); } catch { console.error('Merge token revocation failed'); }
  }
}
