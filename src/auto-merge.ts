import { createHash } from 'node:crypto';
import { addedLines, checksPassed, safeText, type ChangedFile } from './core.ts';
import { loadCheckEvidence, type CheckEvidence } from './checks.ts';
import { githubApi, type Target } from './webhook.ts';

const ownerId = 135234546;
const repos = new Set(['Oddmash/kowrap', 'Oddmash/oddmash-ui', 'Oddmash/interaction-inspector', 'Oddmash/Vertactics']);
const sha = /^[a-f0-9]{40}$/i;
type Api = ReturnType<typeof githubApi>;
type Identity = { id: number; login: string };
export type MergePull = { number: number; state: string; draft: boolean; user: Identity; body: string | null; changed_files: number; mergeable: boolean | null; mergeable_state: string; merge_commit_sha?: string | null; head: { sha: string; repo: { id: number; full_name: string } | null }; base: { sha: string; ref: string; repo: { id: number; private: boolean; full_name: string; default_branch: string; archived?: boolean; allow_squash_merge?: boolean } }; labels: { name: string }[] };
type Issue = { number: number; state: string; body: string | null; user: Identity; pull_request?: unknown; updated_at: string };
type Branch = { protected: boolean; commit: { sha: string }; protection?: { enabled: boolean; required_status_checks?: { enforcement_level: string; checks?: { context: string; app_id: number }[] } } };
type Review = { id: number; user: Identity; state: string; commit_id: string; body: string | null };
export type Acceptance = { issue: number; digest: string; body: string; criteria: string[] };
export type Candidate = { pull: MergePull; acceptance: Acceptance };
const maintainer = (user: Identity | undefined) => user?.id === ownerId && user?.login === 'qtaghdi';

export function eligiblePull(pr: MergePull, target: Target): boolean {
  return repos.has(target.repository) && maintainer(pr.user) && pr.state === 'open' && !pr.draft && pr.base.repo.private === false && !pr.base.repo.archived && pr.base.repo.id === target.repositoryId && pr.base.repo.full_name === target.repository && pr.head.repo?.id === target.repositoryId && pr.head.repo.full_name === target.repository && pr.base.ref === pr.base.repo.default_branch && pr.base.ref === 'main' && sha.test(pr.head.sha) && sha.test(pr.base.sha) && sha.test(pr.merge_commit_sha ?? '') && pr.changed_files > 0 && pr.changed_files <= 20 && !pr.labels.some(l => /(?:^|: )(?:no auto.merge|do not merge|manual|blocked|hold|wip)$/i.test(l.name));
}

export function lowRisk(files: ChangedFile[], count: number): boolean {
  if (!files.length || files.length !== count || count > 20) return false;
  return files.every(f => {
    const path = f.filename;
    if (!f.patch || /(?:policy|release|deploy|security|auth|architecture|credential|instructions|review)/i.test(path) || /(?:^|\/)(?:AGENTS\.md|CONTRIBUTING\.md|SECURITY\.md|CODEOWNERS|PROMPT\.md|SPEC\.md|CHANGELOG\.md|\.github|scripts|auth|security)(?:\/|$)/i.test(path)) return false;
    const docs = /^(?:README(?:\.[a-z-]+)?\.md|docs\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.md)$/i.test(path) && ['added', 'modified'].includes(f.status);
    return docs;
  });
}

export function linkedIssue(body: string | null): number | null {
  const text = body ?? '';
  if (text.length > 12000 || /\x60\x60\x60/.test(text)) return null;
  const links = [...text.matchAll(/^(?:closes|fixes|resolves)\s+#([1-9]\d*)\s*$/gim)];
  const closing = [...text.matchAll(/\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+(?:#|[a-z0-9_.-]+\/|https?:\/\/)/gi)];
  if (links.length !== 1 || closing.length !== 1) return null;
  const n = Number(links[0][1]);
  return Number.isSafeInteger(n) ? n : null;
}

export function acceptanceOf(issue: Issue): Acceptance | null {
  if (!maintainer(issue.user) || issue.state !== 'open' || issue.pull_request || !issue.body || issue.body.length > 12000 || safeText(issue.body) !== issue.body) return null;
  const sections = issue.body.split(/\r?\n/);
  const start = sections.findIndex(line => /^## Acceptance criteria\s*$/i.test(line));
  if (start < 0) return null;
  const end = sections.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  const lines = sections.slice(start + 1, end < 0 ? undefined : end).filter(l => l.trim());
  const criteria = lines.map(l => l.match(/^\s*-\s+\[[ xX]\]\s+(.+)$/)?.[1]?.trim());
  if (!criteria.length || criteria.length > 8 || criteria.some(c => !c || c.length < 12 || c.length > 500)) return null;
  return { issue: issue.number, digest: createHash('sha256').update(JSON.stringify([issue.number, issue.updated_at, issue.body])).digest('hex'), body: issue.body, criteria: criteria as string[] };
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

export async function mergeCandidate(api: Api, target: Target, number: number): Promise<Candidate | null> {
  const root = '/repos/' + target.repository;
  const pr = await api<MergePull>(root + '/pulls/' + number);
  if (!eligiblePull(pr, target)) return null;
  const issueNumber = linkedIssue(pr.body);
  if (!issueNumber || issueNumber === number) return null;
  const issue = await api<Issue>(root + '/issues/' + issueNumber);
  const acceptance = acceptanceOf(issue);
  if (!acceptance || acceptance.issue !== issueNumber) return null;
  const files = await api<ChangedFile[]>(root + '/pulls/' + number + '/files?per_page=100');
  if (!lowRisk(files, pr.changed_files)) return null;
  return { pull: pr, acceptance };
}

export function protectedBranch(branch: Branch, base: string): boolean {
  const p = branch.protection;
  return branch.protected === true && branch.commit.sha === base && p?.enabled === true && p.required_status_checks?.enforcement_level === 'everyone' && !!p.required_status_checks.checks?.some(c => c.context === 'verify' && c.app_id === 15368);
}

export async function mergeAuthorized(api: Api, target: Target, candidate: Candidate, bot: string, reviewId: number, issueVerified: boolean, mint: () => Promise<Api>): Promise<boolean> {
  if (!issueVerified) return false;
  const root = '/repos/' + target.repository;
  const number = candidate.pull.number;
  const current = await mergeCandidate(api, target, number);
  if (!current || current.acceptance.digest !== candidate.acceptance.digest || current.pull.head.sha !== candidate.pull.head.sha || current.pull.base.sha !== candidate.pull.base.sha || current.pull.merge_commit_sha !== candidate.pull.merge_commit_sha || current.pull.mergeable !== true || current.pull.mergeable_state !== 'clean') return false;
  const branch = await api<Branch>(root + '/branches/main');
  if (!protectedBranch(branch, current.pull.base.sha)) return false;
  const compare = await api<{ behind_by: number; merge_base_commit: { sha: string } }>(root + '/compare/' + current.pull.base.sha + '...' + current.pull.head.sha);
  if (compare.behind_by !== 0 || compare.merge_base_commit.sha !== current.pull.base.sha) return false;
  const reviews = await api<Review[]>(root + '/pulls/' + number + '/reviews?per_page=100');
  if (reviews.length >= 100 || !reviews.some(r => r.id === reviewId && r.user.login === bot && r.state === 'APPROVED' && r.commit_id === current.pull.head.sha) || reviews.some(r => r.user.login !== bot && r.commit_id === current.pull.head.sha && r.state === 'COMMENTED' && !!r.body?.trim()) || reviews.some(r => r.state === 'CHANGES_REQUESTED' && !reviews.some(later => later.id > r.id && later.user.id === r.user.id && ['APPROVED', 'DISMISSED'].includes(later.state)))) return false;
  const checks = await loadCheckEvidence(current.pull.head.sha, current.pull.merge_commit_sha, ref => api<CheckEvidence>(root + '/commits/' + ref + '/check-runs?per_page=100'));
  if (!checks.total_count || checks.total_count !== checks.check_runs.length || !checksPassed(checks.check_runs) || !checks.check_runs.some(c => c.name === 'verify' && c.conclusion === 'success' && c.status === 'completed' && c.app?.id === 15368)) return false;
  for (const ref of [current.pull.head.sha, current.pull.merge_commit_sha!]) {
    const status = await api<{ total_count: number; state: string; statuses: unknown[] }>(root + '/commits/' + ref + '/status');
    if (status.total_count !== status.statuses.length || (status.total_count > 0 && status.state !== 'success')) return false;
  }
  const final = await api<MergePull>(root + '/pulls/' + number);
  if (!eligiblePull(final, target) || final.head.sha !== current.pull.head.sha || final.base.sha !== current.pull.base.sha || final.merge_commit_sha !== current.pull.merge_commit_sha || final.mergeable_state !== 'clean' || final.mergeable !== true || linkedIssue(final.body) !== current.acceptance.issue) return false;
  const finalIssue = acceptanceOf(await api<Issue>(root + '/issues/' + current.acceptance.issue));
  if (!finalIssue || finalIssue.digest !== current.acceptance.digest) return false;
  const writer = await mint();
  try {
    const merged = await writer<{ merged: boolean }>(root + '/pulls/' + number + '/merge', { method: 'PUT', body: JSON.stringify({ sha: final.head.sha, merge_method: 'squash' }) });
    return merged.merged === true;
  } finally {
    try { await writer('/installation/token', { method: 'DELETE' }); } catch { console.error('Merge token revocation failed'); }
  }
}
