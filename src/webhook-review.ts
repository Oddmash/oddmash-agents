import { createHash } from 'node:crypto';
import { runReview } from './reviewer.ts';
import { checksPassed } from './core.ts';
import { loadCheckEvidence, type CheckEvidence } from './checks.ts';
import { authorize, type Target } from './webhook.ts';

type Pull = { number: number; state: string; draft: boolean; head: { sha: string }; base: { sha: string; repo: { private: boolean; full_name: string } }; labels: { name: string }[]; merge_commit_sha?: string | null };
type Review = { body: string | null; user: { login: string }; state: string; commit_id: string };

const statuses = ['review: pending', 'review: approved', 'review: changes requested', 'review: needs human'];

export async function reviewWebhook(target: Target, config: { appId: string; key: string; slug: string; openaiKey: string; model: string }) {
  const { appId, key, slug, openaiKey, model } = config;
  const bot = slug + '[bot]';
  if (!/^[a-z0-9-]+\[bot\]$/i.test(bot) || !openaiKey) throw new Error('Missing app configuration');
  const { api, token: githubToken } = await authorize(target, appId, key);
  const repository = target.repository;
  const root = '/repos/' + repository;
  const prs = target.number ? [await api<Pull>(root + '/pulls/' + target.number)] : await api<Pull[]>(root + '/pulls?state=open&per_page=100');
  for (const pr of prs.filter(pr => !target.sha || pr.head.sha === target.sha || pr.merge_commit_sha === target.sha).slice(0, 3)) {
    await reviewOne(await api<Pull>(root + '/pulls/' + pr.number));
  }
  async function reviewOne(pr: Pull) {
    if (pr.draft || pr.state !== 'open' || pr.base.repo.private || pr.base.repo.full_name !== repository) return;
    const path = `${root}/pulls/${pr.number}`;
    const reviews = await api<Review[]>(`${path}/reviews?per_page=100`);
    if (reviews.length === 100) return;
    const own = reviews.filter(review => review.user.login === bot && review.commit_id === pr.head.sha);
    if (own.some(review => review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED')) return;
    const readChecks = (item: Pull) => loadCheckEvidence(item.head.sha, item.merge_commit_sha, sha => api<CheckEvidence>(`${root}/commits/${sha}/check-runs?per_page=100`));
    const checks = await readChecks(pr);
    const fingerprint = createHash('sha256').update(JSON.stringify([repository, pr.number, pr.head.sha, pr.base.sha, checks.total_count, checks.check_runs.map(check => [check.id, check.status, check.conclusion]).sort()])).digest('hex').slice(0, 24);
    const marker = `<!-- oddmash-app-review:${fingerprint} -->`;
    if (own.some(review => review.body?.includes(marker))) return;
    if (checks.check_runs.some(check => check.status !== 'completed')) return;
    const result = await runReview({ repository, number: pr.number, githubToken, openaiKey, model, post: true, allowedRepositories: [repository] });
    const current = await api<Pull>(path);
    if (current.head.sha !== result.head || current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha || current.merge_commit_sha !== pr.merge_commit_sha || current.state !== 'open' || current.draft) return;
    const latest = await api<Review[]>(`${path}/reviews?per_page=100`);
    if (latest.length === 100 || latest.some(review => review.user.login === bot && review.commit_id === current.head.sha && (review.body?.includes(marker) || ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)))) return;
    const finalChecks = await readChecks(current);
    const passing = (finalChecks.total_count ?? 0) > 0 && finalChecks.total_count === finalChecks.check_runs.length && checksPassed(finalChecks.check_runs);
    const event = result.decision === 'APPROVE' && !passing ? 'COMMENT' : result.decision;
    const body = event === 'APPROVE' ? 'No actionable findings in the reviewed changes. Available checks passed. Maintainer review remains required for merge.' : event === 'REQUEST_CHANGES' ? 'Actionable findings were identified. Please review the inline comments and update the PR.' : 'Maintainer verification is required. See the review report for findings or incomplete coverage/check evidence.';
    await api(`${path}/reviews`, { method: 'POST', body: JSON.stringify({ commit_id: result.head, event, body: `${marker}\n${body}\n\n${result.report}` }) });
    const label = event === 'APPROVE' ? 'review: approved' : event === 'REQUEST_CHANGES' ? 'review: changes requested' : 'review: needs human';
    const labels = await api<{ name: string }[]>(`${root}/labels?per_page=100`);
    if (!labels.some(item => item.name === label)) {
      try { await api(`${root}/labels`, { method: 'POST', body: JSON.stringify({ name: label, color: label === 'review: approved' ? '0e8a16' : label === 'review: changes requested' ? 'd73a4a' : 'fbca04' }) }); }
      catch { const existing = await api<{ name: string }>(`${root}/labels/${encodeURIComponent(label)}`); if (existing.name !== label) throw new Error('Label unavailable'); }
    }
    await api(`${root}/issues/${pr.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [label] }) });
    for (const attached of current.labels) {
      if (attached.name !== label && statuses.includes(attached.name)) await api(`${root}/issues/${pr.number}/labels/${encodeURIComponent(attached.name)}`, { method: 'DELETE' });
    }

  }
}
