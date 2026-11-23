import { createHash } from 'node:crypto';
import { runReview } from './reviewer.ts';
import { checksPassed, formatReviewBody } from './core.ts';
import { loadCheckEvidence, type CheckEvidence } from './checks.ts';
import { authorize, type Target } from './webhook.ts';

type Pull = { number: number; state: string; draft: boolean; head: { sha: string }; base: { sha: string; repo: { private: boolean; full_name: string } }; labels: { name: string }[]; merge_commit_sha?: string | null };
type Review = { id: number; body: string | null; user: { login: string }; state: string; commit_id: string };

type Api = ReturnType<typeof import('./webhook.ts').githubApi>;

export async function acquirePendingReview(api: Api, path: string, head: string, bot: string): Promise<number | null> {
  try {
    const pending = await api<Review>(`${path}/reviews`, { method: 'POST', body: JSON.stringify({ commit_id: head, body: '<!-- oddmash-review-lock -->' }) });
    if (pending.state !== 'PENDING' || pending.user.login !== bot || !Number.isSafeInteger(pending.id)) throw new Error('Unexpected pending review response');
    return pending.id;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('(422)')) throw error;
    const reviews = await api<Review[]>(`${path}/reviews?per_page=100`);
    if (reviews.some(review => review.user.login === bot && (review.state === 'PENDING' || review.commit_id === head && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state)))) return null;
    throw error;
  }
}

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
    if (reviews.some(review => review.user.login === bot && review.state === 'PENDING')) return;
    const pendingId = await acquirePendingReview(api, path, pr.head.sha, bot).catch(error => { throw new Error('Pending review: ' + (error instanceof Error ? error.message : 'Unexpected error')); });
    if (pendingId === null) return;
    let submitted = false;
    try {
      const result = await runReview({ repository, number: pr.number, githubToken, openaiKey, model, post: false, allowedRepositories: [repository] });
      const current = await api<Pull>(path);
      if (current.head.sha !== result.head || current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha || current.merge_commit_sha !== pr.merge_commit_sha || current.state !== 'open' || current.draft) return;
      const latest = await api<Review[]>(`${path}/reviews?per_page=100`);
      if (latest.length === 100 || latest.some(review => review.user.login === bot && review.commit_id === current.head.sha && (review.body?.includes(marker) || ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)))) return;
      const finalChecks = await readChecks(current);
      const passing = (finalChecks.total_count ?? 0) > 0 && finalChecks.total_count === finalChecks.check_runs.length && checksPassed(finalChecks.check_runs);
      const event = result.decision === 'APPROVE' && !passing ? 'COMMENT' : result.decision;
      await api(`${path}/reviews/${pendingId}/events`, { method: 'POST', body: JSON.stringify({ event, body: formatReviewBody(event, marker, result.report) }) }).catch(error => { throw new Error('Submit review: ' + (error instanceof Error ? error.message : 'Unexpected error')); });
      submitted = true;
      if (event !== 'APPROVE' && result.comments.length) {
        const existing = await api<{ body: string; user: { login: string } }[]>(`${path}/comments?per_page=100`);
        if (existing.length < 100) for (const comment of result.comments) {
          const marker = comment.body.match(/<!-- oddmash-finding:[a-f0-9]{24} -->/)?.[0];
          if (!marker || existing.some(item => item.user.login === bot && item.body.includes(marker))) continue;
          const latest = await api<Pull>(path);
          if (latest.head.sha !== result.head || latest.state !== 'open' || latest.draft || latest.base.repo.private) break;
          await api(`${path}/comments`, { method: 'POST', body: JSON.stringify({ ...comment, commit_id: result.head }) });
        }
      }
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
    } finally {
      if (!submitted) {
        try {
          const pending = await api<Review>(`${path}/reviews/${pendingId}`);
          if (pending.state === 'PENDING' && pending.user.login === bot && pending.body?.includes('<!-- oddmash-review-lock -->')) await api(`${path}/reviews/${pendingId}`, { method: 'DELETE' });
        } catch { console.error('Pending review cleanup failed'); }
      }
    }
  }
}
