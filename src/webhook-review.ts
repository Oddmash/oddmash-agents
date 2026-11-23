import { createHash } from 'node:crypto';
import { runReview } from './reviewer.ts';
import { formatReviewBody } from './core.ts';
import { finalReviewEvent, loadCheckEvidence, reviewChecksReady, type CheckEvidence } from './checks.ts';
import { mergeCandidate, mergeAuthorized } from './auto-merge.ts';
import { authorize, authorizeMerge, reactToComment, type Target } from './webhook.ts';
import { replyToReview } from './review-discussion.ts';

type Pull = { number: number; user: { id: number; login: string }; state: string; draft: boolean; head: { sha: string }; base: { sha: string; repo: { private: boolean; full_name: string; id: number } }; labels: { name: string }[]; merge_commit_sha?: string | null };
export type Review = { id: number; node_id?: string; body: string | null; user: { login: string }; state: string; commit_id: string };

type Api = ReturnType<typeof import('./webhook.ts').githubApi>;

export function existingAdvisoryReview(reviews: Review[], bot: string, head: string): Review | undefined {
  return reviews.filter(review => review.user.login === bot && review.commit_id === head && review.state === 'COMMENTED' && review.body?.includes('<!-- oddmash-app-review:')).at(-1);
}

export function hasOfficialReview(reviews: Review[], bot: string): boolean {
  return reviews.some(review => review.user.login === bot && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(review.state) && review.body?.includes('<!-- oddmash-app-review:'));
}

export async function acknowledgePendingChecks(api: Api, repository: string, number: number, bot: string, comment: NonNullable<Target['requestComment']>) {
  const path = `/repos/${repository}/${comment.kind === 'issue' ? 'issues' : 'pulls'}/${number}/comments`;
  const marker = `<!-- oddmash-recheck-wait:${comment.id} -->`;
  const existing = await api<{ body: string; user: { login: string } }[]>(`${path}?per_page=100`);
  if (existing.length >= 100 || existing.some(item => item.user.login === bot && item.body.includes(marker))) return;
  if (comment.kind === 'inline' && !comment.root) return;
  const body = `${marker}\nReview requested. Please request it again once the required checks have finished.\n\n<details>\n<summary>한국어 (Korean)</summary>\n\n리뷰 요청을 확인했습니다. 필수 검사가 완료되면 다시 요청해 주세요.\n\n</details>`;
  await api(comment.kind === 'inline' ? `${path}/${comment.root}/replies` : path, { method: 'POST', body: JSON.stringify({ body }) });
}

export function reviewFingerprint(repository: string, number: number, head: string, base: string, checks: CheckEvidence, recheck?: string): string {
  const fingerprint = createHash('sha256').update(JSON.stringify(['v2', repository, number, head, base, checks.total_count, checks.check_runs.map(check => [check.id, check.status, check.conclusion]).sort(), ...(recheck ? [recheck] : [])])).digest('hex').slice(0, 24);
  return `<!-- oddmash-app-review:${fingerprint} -->`;
}

export function canRetryApprovedMerge(review: Review, marker: string): boolean {
  return review.state === 'APPROVED' && !review.body?.includes(marker);
}

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

type InlineFinding = { body: string; path: string; line: number; side: 'RIGHT' };

export async function attachReviewFindings(api: Api, path: string, pendingId: number, head: string, bot: string, findings: InlineFinding[]): Promise<number> {
  if (!findings.length) return 0;
  const existing: { body: string; user: { login: string } }[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api<typeof existing>(`${path}/comments?per_page=100&page=${page}`);
    existing.push(...batch);
    if (batch.length < 100) break;
    if (page === 10) { console.warn('Inline findings withheld: comment pagination budget exceeded.'); return 0; }
  }
  const comments = findings.filter(comment => {
    const marker = comment.body.match(/<!-- oddmash-finding:[a-f0-9]{24} -->/)?.[0];
    return marker && !existing.some(item => item.user.login === bot && item.body.includes(marker));
  }).slice(0, 12);
  if (!comments.length) return 0;
  const review = await api<Review>(`${path}/reviews/${pendingId}`);
  if (review.state !== 'PENDING' || review.user.login !== bot || review.commit_id !== head || !review.node_id || !review.body?.includes('<!-- oddmash-review-lock -->')) throw new Error('Pending review identity changed');
  const variables = Object.fromEntries(comments.map((comment, index) => [`finding${index}`, { pullRequestReviewId: review.node_id, body: comment.body, path: comment.path, line: comment.line, side: comment.side }]));
  const declarations = comments.map((_, index) => `$finding${index}: AddPullRequestReviewThreadInput!`).join(', ');
  const fields = comments.map((_, index) => `finding${index}: addPullRequestReviewThread(input: $finding${index}) { thread { id } }`).join('\n');
  const result = await api<{ errors?: unknown[]; data?: Record<string, { thread?: { id?: string } }> }>('/graphql', { method: 'POST', body: JSON.stringify({ query: `mutation BatchReviewFindings(${declarations}) { ${fields} }`, variables }) });
  if (result.errors?.length || comments.some((_, index) => !result.data?.[`finding${index}`]?.thread?.id)) throw new Error('Pending review findings could not be attached');
  return comments.length;
}

const statuses = ['review: pending', 'review: approved', 'review: changes requested', 'review: needs human'];

export async function reviewWebhook(target: Target, config: { appId: string; key: string; slug: string; openaiKey: string; model: string; autoMerge?: boolean }) {
  const { appId, key, slug, openaiKey, model } = config;
  const bot = slug + '[bot]';
  if (!/^[a-z0-9-]+\[bot\]$/i.test(bot) || !openaiKey) throw new Error('Missing app configuration');
  const { api, token: githubToken } = await authorize(target, appId, key);
  const repository = target.repository;
  const root = '/repos/' + repository;
  const eligibleBase = (item: Pull) => item.base.repo.full_name === repository && item.base.repo.id === target.repositoryId && item.base.repo.private === Boolean(target.private);
  if (target.reply && target.number) {
    await replyToReview(api, target, { slug, openaiKey, model });
    return;
  }
  const prs = target.number ? [await api<Pull>(root + '/pulls/' + target.number)] : await api<Pull[]>(root + '/pulls?state=open&per_page=100');
  for (const pr of prs.filter(pr => !target.sha || pr.head.sha === target.sha || pr.merge_commit_sha === target.sha).slice(0, 3)) {
    await reviewOne(await api<Pull>(root + '/pulls/' + pr.number));
  }
  async function reviewOne(pr: Pull) {
    if (pr.draft || pr.state !== 'open' || !eligibleBase(pr)) return;
    const path = `${root}/pulls/${pr.number}`;
    const reviews = await api<Review[]>(`${path}/reviews?per_page=100`);
    if (reviews.length === 100) return;
    if (!target.recheck && hasOfficialReview(reviews, bot)) return;
    if (target.requestComment) await reactToComment(api, repository, target.requestComment, 'eyes');
    const requestTag = target.recheck ? `<!-- oddmash-recheck:${createHash('sha256').update(target.recheck).digest('hex').slice(0, 24)} -->` : undefined;
    if (requestTag && reviews.some(review => review.user.login === bot && review.body?.includes(requestTag))) return;
    const own = reviews.filter(review => review.user.login === bot && review.commit_id === pr.head.sha);
    const decisive = own.filter(review => ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)).at(-1);
    if (!target.recheck && decisive?.state === 'CHANGES_REQUESTED') return;
    const approved = !target.recheck && decisive?.state === 'APPROVED' ? decisive : undefined;
    if (approved && (!config.autoMerge || target.private)) return;
    const readChecks = (item: Pull) => loadCheckEvidence(item.head.sha, item.merge_commit_sha, sha => api<CheckEvidence>(`${root}/commits/${sha}/check-runs?per_page=100`));
    const checks = await readChecks(pr);
    const marker = reviewFingerprint(repository, pr.number, pr.head.sha, pr.base.sha, checks, target.recheck);
    if (approved && !canRetryApprovedMerge(approved, marker)) return;
    if (own.some(review => review.body?.includes(marker))) return;
    if (!reviewChecksReady(checks) || (target.requestComment && !checks.check_runs.every(check => ['success', 'skipped'].includes(check.conclusion ?? '')))) {
      if (target.requestComment) await acknowledgePendingChecks(api, repository, pr.number, bot, target.requestComment);
      return;
    }
    if (reviews.some(review => review.user.login === bot && review.state === 'PENDING')) return;
    const pendingId = await acquirePendingReview(api, path, pr.head.sha, bot).catch(error => { throw new Error('Pending review: ' + (error instanceof Error ? error.message : 'Unexpected error')); });
    if (pendingId === null) return;
    let submitted = false;
    try {
      const withheld = (reason: string) => console.log('Maintainer auto-merge withheld: ' + reason);
      const candidate = config.autoMerge && !target.private ? await mergeCandidate(api, target, pr.number, withheld).catch(error => {
        withheld(error instanceof Error && /^GitHub request failed \(\d{3}\)$/.test(error.message) ? error.message : 'candidate lookup failed');
        return null;
      }) : null;
      if (approved && !candidate) return;
      const result = await runReview({ repository, number: pr.number, githubToken, openaiKey, model, post: false, allowedRepositories: [repository], acceptance: candidate?.acceptance, privateRepositoryId: target.private ? target.repositoryId : undefined });
      const current = await api<Pull>(path);
      if (current.head.sha !== result.head || current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha || current.merge_commit_sha !== pr.merge_commit_sha || current.state !== 'open' || current.draft || !eligibleBase(current)) return;
      const latest = await api<Review[]>(`${path}/reviews?per_page=100`);
      if (latest.length === 100 || latest.some(review => review.user.login === bot && review.commit_id === current.head.sha && review.id !== approved?.id && (review.body?.includes(marker) || (requestTag && review.body?.includes(requestTag)) || (!target.recheck && ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state) && (!approved || review.id > approved.id))))) return;
      const finalChecks = await readChecks(current);
      const event = finalReviewEvent(result.assessment, finalChecks);
      if (!event) return;
      const finalMarker = reviewFingerprint(repository, pr.number, current.head.sha, current.base.sha, finalChecks, target.recheck);
      const body = formatReviewBody(event, finalMarker, result.report, current.user) + (requestTag ? `\n\n${requestTag}` : '');
      const attemptMerge = async (reviewId: number) => {
        if (!candidate || candidate.pull.head.sha !== result.head || candidate.pull.base.sha !== current.base.sha) return;
        if (!result.issueVerified) { withheld('issue acceptance evidence not verified'); return; }
        try {
          const merged = await mergeAuthorized(api, target, candidate, bot, reviewId, result.issueVerified, () => authorizeMerge(target, appId, key), withheld);
          if (merged) console.log('Maintainer auto-merge completed');
        } catch (error) {
          withheld(error instanceof Error && /^GitHub request failed \(\d{3}\)$/.test(error.message) ? error.message : 'merge request failed');
        }
      };
      if (approved) {
        if (event === 'APPROVE') {
          await api(`${path}/reviews/${approved.id}`, { method: 'PUT', body: JSON.stringify({ body }) });
          await attemptMerge(approved.id);
        }
        return;
      }
      const advisory = event === 'COMMENT' && !target.recheck ? existingAdvisoryReview(latest, bot, current.head.sha) : undefined;
      const attached = event !== 'APPROVE' ? await attachReviewFindings(api, path, pendingId, result.head, bot, result.comments) : 0;
      if (advisory && !attached) {
        if (advisory.body !== body) await api(`${path}/reviews/${advisory.id}`, { method: 'PUT', body: JSON.stringify({ body }) });
      } else {
        const beforeSubmit = await api<Pull>(path);
        if (beforeSubmit.head.sha !== result.head || beforeSubmit.base.sha !== current.base.sha || beforeSubmit.merge_commit_sha !== current.merge_commit_sha || beforeSubmit.state !== 'open' || beforeSubmit.draft || !eligibleBase(beforeSubmit)) return;
        await api(`${path}/reviews/${pendingId}/events`, { method: 'POST', body: JSON.stringify({ event, body }) }).catch(error => { throw new Error('Submit review: ' + (error instanceof Error ? error.message : 'Unexpected error')); });
        submitted = true;
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
      if (event === 'APPROVE' && !target.private) await attemptMerge(pendingId);
      if (event === 'APPROVE' && target.requestComment) await reactToComment(api, repository, target.requestComment, '+1');
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
