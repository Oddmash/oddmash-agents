import { createHash } from 'node:crypto';
import { runReview } from './reviewer.ts';
import { checksPassed, formatReviewBody } from './core.ts';
import { publicRepositories as repositories, reviewTarget } from './routing.ts';
import { loadCheckEvidence, type CheckEvidence } from './checks.ts';

const target = reviewTarget(process.env.REVIEW_REPOSITORY ?? '', process.env.REVIEW_PR_NUMBER ?? '');
const githubToken = process.env.GITHUB_TOKEN ?? '';
const openaiKey = process.env.OPENAI_API_KEY ?? '';
const bot = `${process.env.REVIEWER_APP_SLUG ?? ''}[bot]`;
if (!githubToken || !openaiKey || !/^[a-z0-9-]+\[bot\]$/i.test(bot)) throw new Error('App configuration missing');

const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response.status === 204 ? undefined as T : await response.json() as T;
};

type Pull = { number: number; state: string; draft: boolean; head: { sha: string }; base: { sha: string; repo: { private: boolean; full_name: string } }; labels: { name: string }[]; merge_commit_sha?: string | null };
type Review = { body: string | null; user: { login: string }; state: string; commit_id: string };
const installation = await api<{ repositories: { full_name: string; private: boolean }[] }>('/installation/repositories?per_page=100');
const enabled = new Set(installation.repositories.filter(repo => !repo.private).map(repo => repo.full_name));
const statuses = ['review: pending', 'review: approved', 'review: changes requested', 'review: needs human'];
let processed = 0;
for (const repository of repositories) {
  if (!enabled.has(repository) || processed >= 3 || (target && target.repository !== repository)) continue;
  const root = `/repos/${repository}`;
  const prs = target ? [await api<Pull>(`${root}/pulls/${target.number}`)] : await api<Pull[]>(`${root}/pulls?state=open&per_page=30&sort=updated&direction=desc`);
  for (const pr of prs) {
    if (processed >= 3) break;
    if (pr.draft || pr.state !== 'open' || pr.base.repo.private || pr.base.repo.full_name !== repository) continue;
    const path = `${root}/pulls/${pr.number}`;
    const reviews = await api<Review[]>(`${path}/reviews?per_page=100`);
    if (reviews.length === 100) continue;
    const own = reviews.filter(review => review.user.login === bot && review.commit_id === pr.head.sha);
    if (own.some(review => review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED')) continue;
    const readChecks = (item: Pull) => loadCheckEvidence(item.head.sha, item.merge_commit_sha, sha => api<CheckEvidence>(`${root}/commits/${sha}/check-runs?per_page=100`));
    const checks = await readChecks(pr);
    const fingerprint = createHash('sha256').update(JSON.stringify([repository, pr.number, pr.head.sha, pr.base.sha, checks.total_count, checks.check_runs.map(check => [check.id, check.status, check.conclusion]).sort()])).digest('hex').slice(0, 24);
    const marker = `<!-- oddmash-app-review:${fingerprint} -->`;
    if (own.some(review => review.body?.includes(marker))) continue;
    processed++;
    const result = await runReview({ repository, number: pr.number, githubToken, openaiKey, model: process.env.OPENAI_MODEL ?? 'gpt-5.4', post: true, allowedRepositories: repositories });
    const current = await api<Pull>(path);
    if (current.head.sha !== result.head || current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha || current.merge_commit_sha !== pr.merge_commit_sha || current.state !== 'open' || current.draft) continue;
    const finalChecks = await readChecks(current);
    const passing = (finalChecks.total_count ?? 0) > 0 && finalChecks.total_count === finalChecks.check_runs.length && checksPassed(finalChecks.check_runs);
    const event = result.decision === 'APPROVE' && !passing ? 'COMMENT' : result.decision;
    await api(`${path}/reviews`, { method: 'POST', body: JSON.stringify({ commit_id: result.head, event, body: formatReviewBody(event, marker, result.report) }) });
    const label = event === 'APPROVE' ? 'review: approved' : event === 'REQUEST_CHANGES' ? 'review: changes requested' : 'review: needs human';
    await api(`${root}/issues/${pr.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [label] }) });
    for (const attached of current.labels) {
      if (attached.name !== label && statuses.includes(attached.name)) await api(`${root}/issues/${pr.number}/labels/${encodeURIComponent(attached.name)}`, { method: 'DELETE' });
    }
    console.log(`${repository}#${pr.number}: ${event}`);
  }
}
