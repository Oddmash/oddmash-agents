import { executionContext, runAgentExecution } from './agent-execution.ts';
import { createHash } from 'node:crypto';
import { runImpact } from './impact.ts';
import { runAdvisory } from './advisory.ts';
import { sameFindingText, verifiedReviewer } from './specialist-findings.ts';
import { advisoryModelConfig } from './runtime-config.ts';
import { authorizeCoordinatedAdvisor } from './coordinated-advisory.ts';
import { runReview } from './reviewer.ts';
import { startReviewProgress } from './review-progress.ts';
import { formatReviewBody, publicationFollowUp, reviewOutcome } from './core.ts';
import { checkWaitingSummary, finalReviewEvent, loadCheckEvidence, publicReviewCheckReader, reviewChecksReady, reviewChecksSuccessful, shouldReconcilePendingChecks, type CheckEvidence, type ReviewCheckHead } from './checks.ts';
import { mergeCandidate, mergeAuthorized, mergeProof } from './auto-merge.ts';
import { authorize, authorizeMerge, githubApi, commentReceipt, completeCommentReaction, reactToComment, slashRequestContext, type Target } from './webhook.ts';
import { reconcileReviewThreads, replyToReview, scopedLeadThreadResolution, threadReconciliationExclusions, threadReconciliationMarker } from './review-discussion.ts';
import { retryableJobError } from './review-job.ts';
import { publishAutomationStatus } from './review-status.ts';
import { actionsQuotaEvidence, actionsWorkflowUrl } from './actions-quota.ts';
import { automaticAdvisoryBudget, automaticAdvisoryPaths, coordinatedAdvisoriesEnabled, incrementalPaths, reviewBaseMarker, runCoordinatedAdvisories, selectAdvisoryRoles, type ChangeMetadata, type CompareEvidence } from './review-follow-up-policy.ts';

type Pull = { number: number; user: { id: number; login: string }; state: string; draft: boolean; head: ReviewCheckHead; base: { sha: string; repo: { private: boolean; full_name: string; id: number } }; labels: { name: string }[]; merge_commit_sha?: string | null };
import { acquirePendingReview, clearExpiredWebhookLock, ownsPendingReview, type Review } from './review-lock.ts';
export { acquirePendingReview, expiredWebhookLock, ownsPendingReview, type Review } from './review-lock.ts';

type Api = ReturnType<typeof import('./webhook.ts').githubApi>;

export function existingAdvisoryReview(reviews: Review[], bot: string, head: string): Review | undefined {
  return reviews.filter(review => review.user.login === bot && review.commit_id === head && review.state === 'COMMENTED' && review.body?.includes('<!-- oddmash-app-review:')).at(-1);
}

export function hasOfficialReview(reviews: Review[], bot: string, head?: string): boolean {
  return reviews.some(review => review.user.login === bot && (!head || review.commit_id === head) && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(review.state) && review.body?.includes('<!-- oddmash-app-review:'));
}

export async function acknowledgePendingChecks(api: Api, repository: string, number: number, bot: string, comment: NonNullable<Target['requestComment']>, head: string, state: 'waiting' | 'failed' | 'quota') {
  const path = `/repos/${repository}/${comment.kind === 'issue' ? 'issues' : 'pulls'}/${number}/comments`;
  const marker = `<!-- oddmash-recheck-wait:${comment.id} -->`;
  const existing = await api<{ body: string; user: { login: string } }[]>(`${path}?per_page=100`);
  if (existing.length >= 100 || existing.some(item => item.user.login === bot && item.body.includes(marker))) return;
  if (comment.kind === 'inline' && !comment.root) return;
  const [english, korean] = {
    waiting: ['Review requested. It will start when the required checks pass for this commit.', '리뷰 요청을 확인했습니다. 현재 커밋의 필수 검사가 통과하면 시작합니다.'],
    failed: ['Review requested. The required checks did not pass for this commit. Review can start after a successful rerun.', '리뷰 요청을 확인했습니다. 현재 커밋의 필수 검사가 통과하지 못했습니다. CI를 다시 실행해 통과하면 리뷰를 시작할 수 있습니다.'],
    quota: ['Review requested. GitHub Actions billing or quota is blocking CI for this commit.', '리뷰 요청을 확인했습니다. GitHub Actions 결제 또는 사용량 한도로 현재 커밋의 CI가 차단됐습니다.']
  }[state];
  const body = `${marker}\n<!-- oddmash-deferred:${head}:${comment.kind}:${comment.id}:${comment.root ?? 0}${comment.slash ? ':slash' : ''} -->\n${english}\n\n<details>\n<summary>한국어 (Korean)</summary>\n\n${korean}\n\n</details>`;
  await api(comment.kind === 'inline' ? `${path}/${comment.root}/replies` : path, { method: 'POST', body: JSON.stringify({ body }) });
}

export function deferredRequest(comments: { body: string; user: { login: string } }[], reviews: Review[], bot: string, head: string): Target['requestComment'] {
  for (const item of [...comments].reverse()) {
    if (item.user.login !== bot) continue;
    const match = /<!-- oddmash-deferred:([a-f0-9]{40}):(issue|inline):(\d+):(\d+)(:slash)? -->/.exec(item.body);
    if (!match || match[1] !== head) continue;
    const id = Number(match[3]), root = Number(match[4]);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(root) || (match[2] === 'inline' && root < 1)) continue;
    const tag = `<!-- oddmash-recheck:${createHash('sha256').update(`comment-${id}`).digest('hex').slice(0, 24)} -->`;
    if (reviews.some(review => review.user.login === bot && review.body?.includes(tag))) continue;
    return { kind: match[2] === 'inline' ? 'inline' : 'issue', id, ...(root ? { root } : {}), ...(match[5] ? { slash: true as const } : {}) };
  }
}

export function reviewFingerprint(repository: string, number: number, head: string, base: string, checks: CheckEvidence, recheck?: string): string {
  const fingerprint = createHash('sha256').update(JSON.stringify(['v2', repository, number, head, base, checks.total_count, checks.check_runs.map(check => [check.id, check.status, check.conclusion]).sort(), ...(recheck ? [recheck] : [])])).digest('hex').slice(0, 24);
  return `<!-- oddmash-app-review:${fingerprint} -->`;
}

export function canRetryApprovedMerge(review: Review, marker: string): boolean {
  return review.state === 'APPROVED' && !review.body?.includes(marker);
}

type InlineFinding = { body: string; path: string; line: number; side: 'LEFT' | 'RIGHT' };

export async function attachReviewFindingsWithCoverage(api: Api, path: string, pendingId: number, head: string, bot: string, findings: InlineFinding[]): Promise<{ attached: number; covered: boolean }> {
  if (!findings.length) return { attached: 0, covered: true };
  const existing: (Partial<InlineFinding> & { body: string; user: { login: string; type?: string }; commit_id?: string; in_reply_to_id?: number })[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api<typeof existing>(`${path}/comments?per_page=100&page=${page}`);
    existing.push(...batch);
    if (batch.length < 100) break;
    if (page === 10) { console.warn('Inline findings withheld: comment pagination budget exceeded.'); return { attached: 0, covered: false }; }
  }
  const valid = findings.every(comment => /<!-- oddmash-finding:[a-f0-9]{24} -->/.test(comment.body));
  const comments = findings.filter(comment => {
    const marker = comment.body.match(/<!-- oddmash-finding:[a-f0-9]{24} -->/)?.[0];
    return marker && !existing.some(item =>
      (item.user.login === bot && item.body.includes(marker)) ||
      (item.user.type === 'Bot' && verifiedReviewer.test(item.user.login) && !item.in_reply_to_id &&
        item.body.startsWith('<!-- oddmash-finding:') && item.commit_id === head &&
        item.path === comment.path && item.line === comment.line && comment.side === (item.side ?? 'RIGHT') &&
        sameFindingText(item.body, comment.body)));
  });
  if (!valid || comments.length > 12) return { attached: 0, covered: false };
  if (!comments.length) return { attached: 0, covered: true };
  const review = await api<Review>(`${path}/reviews/${pendingId}`);
  if (review.state !== 'PENDING' || review.user.login !== bot || review.commit_id !== head || !review.node_id || !review.body?.includes('<!-- oddmash-review-lock -->')) throw new Error('Pending review identity changed');
  const variables = Object.fromEntries(comments.map((comment, index) => [`finding${index}`, { pullRequestReviewId: review.node_id, body: comment.body, path: comment.path, line: comment.line, side: comment.side }]));
  const declarations = comments.map((_, index) => `$finding${index}: AddPullRequestReviewThreadInput!`).join(', ');
  const fields = comments.map((_, index) => `finding${index}: addPullRequestReviewThread(input: $finding${index}) { thread { id } }`).join('\n');
  const result = await api<{ errors?: unknown[]; data?: Record<string, { thread?: { id?: string } }> }>('/graphql', { method: 'POST', body: JSON.stringify({ query: `mutation BatchReviewFindings(${declarations}) { ${fields} }`, variables }) });
  if (result.errors?.length || comments.some((_, index) => !result.data?.[`finding${index}`]?.thread?.id)) throw new Error('Pending review findings could not be attached');
  return { attached: comments.length, covered: true };
}

export async function attachReviewFindings(api: Api, path: string, pendingId: number, head: string, bot: string, findings: InlineFinding[]): Promise<number> {
  return (await attachReviewFindingsWithCoverage(api, path, pendingId, head, bot, findings)).attached;
}

const statuses = ['review: pending', 'review: approved', 'review: changes requested', 'review: needs human', 'review: follow-up', 'review: stale'];

export async function reviewWebhook(target: Target, config: { appId: string; key: string; slug: string; openaiKey: string; model: string; autoMerge?: boolean }) {
  const executionStarted = Date.now();
  if (target.advisoryIdentity && target.advisory !== target.advisoryIdentity) throw new Error('Invalid advisory identity');
  const { appId, key, slug, openaiKey, model } = config;
  const bot = slug + '[bot]';
  if (!/^[a-z0-9-]+\[bot\]$/i.test(bot) || !openaiKey) throw new Error('Missing app configuration');
  if (target.advisory && target.requestComment?.slash && !target.advisoryIdentity) {
    const advisor = await authorizeCoordinatedAdvisor(target, target.advisory, appId);
    if (!advisor) { console.info('Requested dedicated advisory is unavailable'); return; }
    if (advisor.target.impact) await runImpact(advisor.api, advisor.target, advisor.config);
    else await runAdvisory(advisor.api, advisor.target, advisor.config);
    return;
  }
  const authorized = await authorize(target, appId, key);
  const { api, token: githubToken } = authorized;
  if (target.advisoryIdentity && target.reply) {
    await replyToReview(api, target, { slug, openaiKey, model, specialist: target.advisoryIdentity });
    return;
  }
  if (target.impact) { await runImpact(authorized.api, target, { bot, ...advisoryModelConfig('impact', { model, openaiKey }) }); return; }
  if (target.advisory) { await runAdvisory(authorized.api, target, { bot, ...advisoryModelConfig(target.advisory, { model, openaiKey }) }); return; }
  const repository = target.repository;
  const root = '/repos/' + repository;
  const eligibleBase = (item: Pull) => item.base.repo.full_name === repository && item.base.repo.id === target.repositoryId && item.base.repo.private === Boolean(target.private);
  if (target.reply && target.number) {
    if (target.reply.byThread) {
      const thread = await api<{ id: number; body: string; user: { type: string; login: string }; in_reply_to_id?: number; pull_request_url: string }>(`${root}/pulls/comments/${target.reply.root}`);
      if (thread.id !== target.reply.root || thread.in_reply_to_id || thread.user?.type !== 'Bot' ||
          thread.pull_request_url !== `https://api.github.com${root}/pulls/${target.number}` ||
          !thread.body?.startsWith('<!-- oddmash-finding:')) return;
      if (thread.user.login !== bot) {
        const role = /^oddmash-(impact|qa|release|docs|architect)\[bot\]$/.exec(thread.user.login)?.[1] as
          'impact' | 'qa' | 'release' | 'docs' | 'architect' | undefined;
        if (!role || !thread.body.split('\n').includes(`<!-- oddmash-specialist:${role} -->`)) return;
        const advisor = await authorizeCoordinatedAdvisor(target, role, appId);
        if (advisor) await runAgentExecution(executionContext(role, ''), () => replyToReview(advisor.api, advisor.target,
          { slug: `oddmash-${role}`, openaiKey: advisor.config.openaiKey, model: advisor.config.model, specialist: role }));
        return;
      }
    }
    const resolve = scopedLeadThreadResolution(target, appId, key, slug, process.env.REVIEWER_UI_THREAD_RESOLVE_ENABLED);
    await replyToReview(api, target, { slug, openaiKey, model, resolve });
    return;
  }
  const prs = target.number ? [await api<Pull>(root + '/pulls/' + target.number)] : await api<Pull[]>(root + '/pulls?state=open&per_page=100');
  for (const pr of prs.filter(pr => !target.sha || pr.head.sha === target.sha || pr.merge_commit_sha === target.sha).slice(0, 3)) {
    await reviewOne(await api<Pull>(root + '/pulls/' + pr.number), target);
  }
  async function reviewOne(pr: Pull, target: Target, reconcileWaiting = true) {
    let api = authorized.api;
    if (pr.draft || pr.state !== 'open' || !eligibleBase(pr) || (target.expectedHead && pr.head.sha !== target.expectedHead)) return;
    const path = `${root}/pulls/${pr.number}`;
    const reviews = await api<Review[]>(`${path}/reviews?per_page=100`);
    if (reviews.length === 100) return;
    if (target.sha && !target.recheck) {
      const comments = await Promise.all([
        api<{ body: string; user: { login: string } }[]>(`${root}/issues/${pr.number}/comments?per_page=100`),
        api<{ body: string; user: { login: string } }[]>(`${path}/comments?per_page=100`)
      ]).catch(() => { console.warn('Deferred review lookup unavailable'); return null; });
      const deferred = comments && comments.every(batch => batch.length < 100) ? deferredRequest(comments.flat(), reviews, bot, pr.head.sha) : undefined;
      if (deferred) {
        target = { ...target, recheck: `comment-${deferred.id}`, requestComment: deferred };
        if (deferred.kind === 'issue') api = (await authorize(target, appId, key)).api;
      }
    }
    const existingApproval = reviews.filter(review => review.user.login === bot && review.commit_id === pr.head.sha && ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)).at(-1);
    const progressEnabled = process.env.REVIEWER_CHECK_PROGRESS_ENABLED === 'true';
    const progressFor = async (waiting = false, reuseOnly = false, waitingSummary?: string) => progressEnabled ? authorize(target, appId, key, fetch, true).then(auth => startReviewProgress(auth.api, repository, pr.head.sha, { appId: Number(appId), number: pr.number, request: target.recheck, waiting, reuseOnly, waitingSummary })).catch(() => { console.warn('Review progress permission unavailable'); return undefined; }) : undefined;
    const reconcileCompletedProgress = async (review: Review | undefined) => {
      const progress = await progressFor(false, true);
      if (!review) await progress?.finish('cancelled', 'No review for this commit', 'A new maintainer review request is required.');
      else if (review.state === 'APPROVED') await progress?.finish('success', 'Review approved');
      else if (review.state === 'CHANGES_REQUESTED') await progress?.finish('failure', 'Changes requested');
      else await progress?.finish('neutral', 'Review follow-up required');
    };
    const mergeStatus = (reason: string, completed = false) => publishAutomationStatus(api, repository, pr.number, bot, pr.head.sha, 'merge', reason, completed);
    const readChecks = (item: Pull) => {
      const read = (sha: string) => api<CheckEvidence>(`${root}/commits/${sha}/check-runs?per_page=100`);
      return loadCheckEvidence(item.head.sha, item.merge_commit_sha, target.private ? read : publicReviewCheckReader(root, item.number, read, fetch, { head: item.head, readPulls: api }), Number(appId));
    };
    const retryExistingApproval = async () => {
      if (existingApproval?.state !== 'APPROVED') return;
      let reason = !config.autoMerge ? 'automatic merge is disabled' : 'merge request failed';
      const withheld = (value: string) => { reason = value; console.log('Maintainer auto-merge withheld: ' + value); };
      try {
        if (config.autoMerge) {
          const quota = actionsQuotaEvidence((await readChecks(pr)).check_runs);
          if (quota) {
            await publishAutomationStatus(api, repository, pr.number, bot, pr.head.sha, 'review', 'Actions billing or quota block', false, actionsWorkflowUrl(quota, repository));
            return;
          }
          const candidate = await mergeCandidate(api, target, pr.number, withheld);
          if (candidate && existingApproval.body?.includes(mergeProof(candidate))) {
            if (await mergeAuthorized(api, target, candidate, bot, existingApproval.id, true, () => authorizeMerge(target, appId, key), withheld)) { await mergeStatus('merge completed', true); return; }
          } else if (candidate) withheld('approval has no current acceptance proof; request a fresh review');
        }
        await mergeStatus(reason);
      } catch (error) {
        await mergeStatus(error instanceof Error ? error.message : reason);
        throw error;
      }
    };
    const retryThreadReconciliation = async (review: Review | undefined) => {
      if (!review?.body || !['APPROVED', 'COMMENTED'].includes(review.state) || !review.body.includes(reviewBaseMarker(pr.base.sha))) return;
      const exclusions = threadReconciliationExclusions(review.body);
      if (exclusions && reviewChecksSuccessful(await readChecks(pr), repository)) {
        await reconcileReviewThreads(api, { ...target, number: pr.number }, config, pr.head.sha, pr.base.sha, fetch, exclusions);
      }
    };
    if (!target.recheck && hasOfficialReview(reviews, bot, pr.head.sha)) {
      const completed = reviews.filter(review => review.user.login === bot && review.commit_id === pr.head.sha && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(review.state) && review.body?.includes('<!-- oddmash-app-review:')).at(-1);
      await reconcileCompletedProgress(completed);
      await retryThreadReconciliation(completed);
      await retryExistingApproval();
      return;
    }
    const requestTag = target.recheck ? `<!-- oddmash-recheck:${createHash('sha256').update(target.recheck).digest('hex').slice(0, 24)} -->` : undefined;
    if (requestTag && reviews.some(review => review.user.login === bot && review.body?.includes(requestTag))) {
      const completed = reviews.filter(review => review.user.login === bot && review.commit_id === pr.head.sha && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(review.state) && review.body?.includes(requestTag)).at(-1);
      await reconcileCompletedProgress(completed);
      if (completed && target.requestComment) {
        const eyes = await commentReceipt(api, repository, target.requestComment, bot);
        if (!await completeCommentReaction(api, repository, target.requestComment, eyes, completed.state === 'APPROVED')) throw new Error('Review completion reaction unavailable');
      }
      await retryThreadReconciliation(completed);
      if (existingApproval?.body?.includes(requestTag)) await retryExistingApproval();
      return;
    }
    const own = reviews.filter(review => review.user.login === bot && review.commit_id === pr.head.sha);
    const decisive = own.filter(review => ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state)).at(-1);
    if (!target.recheck && decisive?.state === 'CHANGES_REQUESTED') return;
    const approved = !target.recheck && decisive?.state === 'APPROVED' ? decisive : undefined;
    if (approved && !config.autoMerge) return;
    const publishWaiting = async (blocked?: string, summary?: string) => {
      if (!progressEnabled || reviews.some(review => review.user.login === bot && review.state === 'PENDING')) return false;
      let lock: number | null = null;
      try {
        lock = await acquirePendingReview(api, path, pr.head.sha, bot, true);
        if (lock === null) return false;
        const current = await api<Pull>(path);
        if (current.head.sha !== pr.head.sha || current.state !== 'open' || current.draft || !eligibleBase(current)) return false;
        const latest = await api<Review[]>(`${path}/reviews?per_page=100`);
        if (!ownsPendingReview(latest, bot, pr.head.sha, lock) || (!target.recheck && hasOfficialReview(latest, bot, pr.head.sha)) || (requestTag && latest.some(review => review.user.login === bot && review.body?.includes(requestTag)))) return false;
        const progress = await progressFor(true, Boolean(blocked), summary);
        if (blocked) await progress?.finish('neutral', blocked, summary ?? 'Required CI did not pass. A successful rerun can start a new review.');
      } catch { console.warn('Waiting review progress unavailable'); }
      finally {
        if (lock !== null) {
          try {
            const pending = await api<Review>(`${path}/reviews/${lock}`);
            if (pending.state === 'PENDING' && pending.user.login === bot && pending.commit_id === pr.head.sha && pending.body?.includes('<!-- oddmash-review-lock -->')) await api(`${path}/reviews/${lock}`, { method: 'DELETE' });
          } catch { console.error('Waiting review lock cleanup failed'); }
        }
      }
      return lock !== null;
    };
    const checks = await readChecks(pr);
    const quota = actionsQuotaEvidence(checks.check_runs);
    if (quota) {
      if (target.requestComment) await acknowledgePendingChecks(api, repository, pr.number, bot, target.requestComment, pr.head.sha, 'quota');
      await publishAutomationStatus(api, repository, pr.number, bot, pr.head.sha, 'review', 'Actions billing or quota block', false, actionsWorkflowUrl(quota, repository));
      await publishWaiting('Review blocked by CI quota');
      return;
    }
    const marker = reviewFingerprint(repository, pr.number, pr.head.sha, pr.base.sha, checks, target.recheck);
    if (approved && !canRetryApprovedMerge(approved, marker)) return;
    if (own.some(review => review.body?.includes(marker))) return;
    if (!reviewChecksSuccessful(checks, repository)) {
      const ready = reviewChecksReady(checks, repository);
      if (target.requestComment) await acknowledgePendingChecks(api, repository, pr.number, bot, target.requestComment, pr.head.sha, ready ? 'failed' : 'waiting');
      if (ready) await publishAutomationStatus(api, repository, pr.number, bot, pr.head.sha, 'review', 'required checks failed');
      const published = await publishWaiting(ready ? 'Review blocked by failed CI' : undefined, checkWaitingSummary(checks, repository));
      if ((published || target.requestComment) && reconcileWaiting) {
        const current = await api<Pull>(path);
        if (current.head.sha === pr.head.sha && current.state === 'open' && !current.draft && eligibleBase(current) && reviewChecksSuccessful(await readChecks(current), repository)) return reviewOne(current, target, false);
      }
      if (shouldReconcilePendingChecks(checks, target.expectedHead, pr.head.sha, process.env.REVIEWER_QUEUE_ENABLED === 'true', repository)) throw new Error('CI evidence pending');
      return;
    }
    const pending = reviews.find(review => review.user.login === bot && review.state === 'PENDING');
    if (pending && !await clearExpiredWebhookLock(api, path, pending, bot)) {
      if ((pending.body?.includes('<!-- oddmash-webhook-lock:') || (progressEnabled && pending.body?.includes('<!-- oddmash-review-lock -->'))) && process.env.REVIEWER_QUEUE_ENABLED === 'true') throw new Error('Pending review active');
      return;
    }
    const pendingId = await acquirePendingReview(api, path, pr.head.sha, bot, true).catch(error => { throw new Error('Pending review: ' + (error instanceof Error ? error.message : 'Unexpected error')); });
    if (pendingId === null) return;
    let submitted = false;
    let requestApproved = false;
    let eyesId: number | undefined;
    let progress: Awaited<ReturnType<typeof progressFor>> = undefined;
    let progressResult: { conclusion: 'success' | 'failure' | 'neutral' | 'cancelled'; title: string } = { conclusion: 'cancelled', title: 'Review not submitted' };
    try {
      const acquired = await api<Review[]>(`${path}/reviews?per_page=100`);
      if (!ownsPendingReview(acquired, bot, pr.head.sha, pendingId)) return;
      if ((!target.recheck && hasOfficialReview(acquired, bot, pr.head.sha)) || (requestTag && acquired.some(review => review.user.login === bot && review.body?.includes(requestTag)))) return;
      eyesId = target.requestComment ? await reactToComment(api, repository, target.requestComment, 'eyes') : undefined;
      progress = await progressFor();
      await progress?.update('Collecting changes', 'Preparing the current commit review.');
      try {
        const active = await api<Pull>(path);
        if (active.head.sha !== pr.head.sha || active.base.sha !== pr.base.sha || active.state !== 'open' || active.draft || !eligibleBase(active)) return;
        await api(`${root}/issues/${pr.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: ['review: pending'] }) });
        for (const attached of active.labels) if (attached.name !== 'review: pending' && statuses.includes(attached.name)) await api(`${root}/issues/${pr.number}/labels/${encodeURIComponent(attached.name)}`, { method: 'DELETE' }).catch(()=>undefined);
      } catch { console.warn('Review pending label unavailable'); }
      let mergeReason = !config.autoMerge ? 'automatic merge is disabled' : 'merge request failed';
      const withheld = (reason: string) => { mergeReason = reason; console.log('Maintainer auto-merge withheld: ' + reason); };
      const candidate = config.autoMerge ? await mergeCandidate(api, target, pr.number, withheld).catch(error => {
        withheld(error instanceof Error && /^GitHub request failed \(\d{3}\)$/.test(error.message) ? error.message : 'candidate lookup failed');
        return null;
      }) : null;
      if (approved && !candidate) return;
      const previous = reviews.filter(review => review.user.login === bot && review.commit_id !== pr.head.sha && review.body?.includes('<!-- oddmash-app-review:') && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(review.state)).at(-1);
      const comparison = !target.recheck && previous?.state === 'APPROVED' && /^[a-f0-9]{40}$/i.test(previous.commit_id) && previous.body?.includes(reviewBaseMarker(pr.base.sha)) ? await api<CompareEvidence>(`${root}/compare/${previous.commit_id}...${pr.head.sha}?per_page=100`).catch(() => undefined) : undefined;
      const incrementalFiles = !target.recheck ? incrementalPaths(previous, pr.head.sha, pr.base.sha, comparison) : undefined;
      const requestContext = await slashRequestContext(api, target, 'review');
      const result = await runReview({ requestContext, repository, number: pr.number, githubToken, openaiKey, model, post: false, allowedRepositories: [repository], acceptance: incrementalFiles === undefined ? candidate?.acceptance : undefined, incrementalFiles, privateRepositoryId: target.private ? target.repositoryId : undefined, progress: progress?.update }).catch(async error => {
        await publishAutomationStatus(api, repository, pr.number, bot, pr.head.sha, 'review', error instanceof Error ? error.message : 'review processing failed');
        throw error;
      });
      const current = await api<Pull>(path);
      if (current.head.sha !== result.head || current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha || current.merge_commit_sha !== pr.merge_commit_sha || current.state !== 'open' || current.draft || !eligibleBase(current)) return;
      const latest = await api<Review[]>(`${path}/reviews?per_page=100`);
      if (!ownsPendingReview(latest, bot, current.head.sha, pendingId) || latest.some(review => review.user.login === bot && review.commit_id === current.head.sha && review.id !== approved?.id && (review.body?.includes(marker) || (requestTag && review.body?.includes(requestTag)) || (!target.recheck && ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state) && (!approved || review.id > approved.id))))) return;
      const finalChecks = await readChecks(current);
      const event = finalReviewEvent(incrementalFiles !== undefined && result.assessment === 'APPROVE' ? 'COMMENT' : result.assessment, finalChecks, repository, current.user);
      const followUp = publicationFollowUp(result.followUp, result.assessment, current.user);
      if (!event) {
        if (reviewChecksReady(finalChecks, repository) && !reviewChecksSuccessful(finalChecks, repository)) await publishAutomationStatus(api, repository, pr.number, bot, pr.head.sha, 'review', 'required checks failed');
        return;
      }
      const finalMarker = reviewFingerprint(repository, pr.number, current.head.sha, current.base.sha, finalChecks, target.recheck);
      await progress?.update('Publishing review', 'Rechecking the current commit and submitting the result.');
      const completedResult = event === 'APPROVE' ? { conclusion: 'success' as const, title: 'Review approved' } : event === 'REQUEST_CHANGES' ? { conclusion: 'failure' as const, title: 'Changes requested' } : { conclusion: 'neutral' as const, title: reviewOutcome(event, followUp).title };
      const proof = incrementalFiles === undefined && event === 'APPROVE' && candidate && result.issueVerified && candidate.pull.head.sha === current.head.sha && candidate.pull.base.sha === current.base.sha && candidate.pull.merge_commit_sha === current.merge_commit_sha ? `\n\n${mergeProof(candidate)}` : '';
      const hasEarlierReview = Boolean(previous) || hasOfficialReview(own, bot, current.head.sha);
      const reconcileThreads = incrementalFiles === undefined && reviewChecksSuccessful(finalChecks, repository) &&
        ((event === 'APPROVE' && target.recheck) || (event === 'COMMENT' && hasEarlierReview));
      const reconciliation = reconcileThreads ? threadReconciliationMarker(result.comments.map(comment => comment.path)) : '';
      const scopeNote = `\n\n${reviewBaseMarker(current.base.sha)}` + (reconciliation ? `\n${reconciliation}` : '') + (incrementalFiles !== undefined ? '\n\nIncremental follow-up only. Earlier files were not re-reviewed; request a full review before approval or merge.\n\n증분 검토입니다. 이전 파일은 다시 검토하지 않았으며 승인 또는 머지 전 전체 리뷰가 필요합니다.' : '');
      let body = formatReviewBody(event, finalMarker, result.report, current.user, followUp) + (requestTag ? `\n\n${requestTag}` : '') + proof + scopeNote;
      const attemptMerge = async (reviewId: number) => {
        if (!candidate) { await mergeStatus(mergeReason); return; }
        if (candidate.pull.head.sha !== result.head || candidate.pull.base.sha !== current.base.sha) { await mergeStatus('candidate changed'); return; }
        if (!result.issueVerified) { withheld('issue acceptance evidence not verified'); await mergeStatus(mergeReason); return; }
        try {
          const merged = await mergeAuthorized(api, target, candidate, bot, reviewId, result.issueVerified, () => authorizeMerge(target, appId, key), withheld);
          if (merged) { console.log('Maintainer auto-merge completed'); await mergeStatus('merge completed', true); }
          else await mergeStatus(mergeReason);
        } catch (error) {
          withheld(error instanceof Error && /^GitHub request failed \(\d{3}\)$/.test(error.message) ? error.message : 'merge request failed');
          await mergeStatus(error instanceof Error ? error.message : mergeReason);
          if (retryableJobError(error)) throw error;
        }
      };
      const publication = await api<Review[]>(`${path}/reviews?per_page=100`);
      if (!ownsPendingReview(publication, bot, current.head.sha, pendingId) || publication.some(review => review.user.login === bot && review.commit_id === current.head.sha && review.id !== approved?.id && (review.body?.includes(finalMarker) || (requestTag && review.body?.includes(requestTag)) || (!target.recheck && ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state))))) return;
      if (approved) {
        if (event === 'APPROVE') {
          await api(`${path}/reviews/${approved.id}`, { method: 'PUT', body: JSON.stringify({ body }) });
          progressResult = completedResult;
          await progress?.finish(progressResult.conclusion, progressResult.title);
          await attemptMerge(approved.id);
        }
        return;
      }
      const advisory = event === 'COMMENT' && !target.recheck ? existingAdvisoryReview(latest, bot, current.head.sha) : undefined;
      const attachment = event !== 'APPROVE' ? await attachReviewFindingsWithCoverage(api, path, pendingId, result.head, bot, result.comments) : { attached: 0, covered: true };
      if (attachment.covered) body = formatReviewBody(event, finalMarker, result.inlineReport, current.user, followUp) + (requestTag ? `\n\n${requestTag}` : '') + proof + scopeNote;
      const publishedReviewId = advisory && !attachment.attached ? advisory.id : pendingId;
      if (advisory && !attachment.attached) {
        if (advisory.body !== body) await api(`${path}/reviews/${advisory.id}`, { method: 'PUT', body: JSON.stringify({ body }) });
      } else {
        const beforeSubmit = await api<Pull>(path);
        if (beforeSubmit.head.sha !== result.head || beforeSubmit.base.sha !== current.base.sha || beforeSubmit.merge_commit_sha !== current.merge_commit_sha || beforeSubmit.state !== 'open' || beforeSubmit.draft || !eligibleBase(beforeSubmit)) return;
        const beforePublish = await api<Review[]>(`${path}/reviews?per_page=100`);
        if (!ownsPendingReview(beforePublish, bot, current.head.sha, pendingId) || beforePublish.some(review => review.user.login === bot && review.commit_id === current.head.sha && (review.body?.includes(finalMarker) || (requestTag && review.body?.includes(requestTag)) || (!target.recheck && ['APPROVED', 'CHANGES_REQUESTED'].includes(review.state))))) return;
        await api(`${path}/reviews/${pendingId}/events`, { method: 'POST', body: JSON.stringify({ event, body }) }).catch(error => { throw new Error('Submit review: ' + (error instanceof Error ? error.message : 'Unexpected error')); });
        submitted = true;
      }
      requestApproved = event === 'APPROVE';
      progressResult = completedResult;
      if (!target.recheck && process.env.REVIEWER_AUTO_ADVISORY_ENABLED !== 'true') console.info('Coordinated advisors disabled');
      if (coordinatedAdvisoriesEnabled(target, process.env.REVIEWER_AUTO_ADVISORY_ENABLED)) {
        const budget = automaticAdvisoryBudget(process.env, Date.now() - executionStarted);
        if (budget.maxRequests > 0 && budget.elapsedMs > 0) {
          const planningStarted = Date.now();
          const planningSignal = AbortSignal.timeout(budget.elapsedMs);
          const boundedRequest = (signal: AbortSignal): typeof fetch => (input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, init?.signal ?? signal]) });
          const metadata = await githubApi(githubToken, boundedRequest(planningSignal))<ChangeMetadata[]>(`${path}/files?per_page=100&page=1`).catch(() => []);
          const scoped = incrementalFiles === undefined ? metadata : metadata.filter(file => incrementalFiles.includes(file.filename));
          const advisoryPaths = automaticAdvisoryPaths(scoped);
          const remaining = { ...budget, elapsedMs: Math.max(0, budget.elapsedMs - (Date.now() - planningStarted)) };
          const roles = selectAdvisoryRoles(scoped, remaining.maxRequests);
          if (roles.includes('qa')) {
            roles.splice(roles.indexOf('qa'), 1);
            roles.unshift('qa');
          }
          console.info(roles.length ? 'Coordinated advisors selected: ' + roles.join(', ') : 'Coordinated advisors skipped: no eligible roles');
          const summaries = new Map<string, string>();
          await runCoordinatedAdvisories(roles, remaining, async (role, signal) => {
            const completed = summaries.size ? ` Completed roles: ${[...summaries.keys()].join(', ')}.` : '';
            await progress?.update(`Specialist review in progress (${role})`, `Lead is coordinating the latest commit.${completed}`);
            const request = boundedRequest(signal);
            const advisor = await authorizeCoordinatedAdvisor({
              installation: target.installation, repository, repositoryId: target.repositoryId, private: target.private,
              number: current.number, expectedHead: current.head.sha
            }, role, appId, request);
            if (!advisor) { console.info('Coordinated advisor unavailable: ' + role); return true; }
            const latest = await advisor.api<Pull>(path);
            if (latest.head.sha !== current.head.sha || latest.base.sha !== current.base.sha || latest.state !== 'open' || latest.draft || !eligibleBase(latest)) return false;
            const advisoryConfig = { ...advisor.config, automatic: true, incrementalFiles: advisoryPaths, collectSummary: (section: string) => { summaries.set(role, section); } };
            await runAgentExecution(executionContext(role, ''), () => role === 'impact' ? runImpact(advisor.api, advisor.target, advisoryConfig, request) : runAdvisory(advisor.api, advisor.target, advisoryConfig, request));
            console.info('Coordinated advisor returned: ' + role);
            return true;
          });
          if (summaries.size) try {
            const latestPull = await api<Pull>(path);
            const review = await api<Review>(`${path}/reviews/${publishedReviewId}`);
            if (latestPull.head.sha === current.head.sha && latestPull.base.sha === current.base.sha &&
                latestPull.state === 'open' && !latestPull.draft && review.user.login === bot &&
                review.commit_id === current.head.sha && review.body === body) {
              const summary = body + '\n\n### Specialist follow-up / 전문 검토 후속 확인\n\n' + [...summaries.values()].join('\n');
              await api(`${path}/reviews/${publishedReviewId}`, { method: 'PUT', body: JSON.stringify({ body: summary }) });
            }
          } catch {
            console.warn('Coordinated review summary update failed');
          }
        } else console.info('Coordinated advisors skipped: budget exhausted');
      }
      if (reconciliation) {
        await progress?.update('Verifying earlier findings', 'Checking the current commit against open review discussions.');
        await reconcileReviewThreads(api, { ...target, number: current.number }, config, current.head.sha, current.base.sha, fetch, threadReconciliationExclusions(reconciliation));
      }
      await progress?.finish(progressResult.conclusion, progressResult.title);
      if (event === 'APPROVE' && incrementalFiles === undefined) await attemptMerge(pendingId);
      await publishAutomationStatus(api, repository, pr.number, bot, current.head.sha, 'review', 'review completed', true);
      const label = reviewOutcome(event, followUp).label;
      const labels = await api<{ name: string }[]>(`${root}/labels?per_page=100`);
      if (!labels.some(item => item.name === label)) {
        try { await api(`${root}/labels`, { method: 'POST', body: JSON.stringify({ name: label, color: label === 'review: approved' ? '0e8a16' : label === 'review: changes requested' ? 'd73a4a' : 'fbca04' }) }); }
        catch { const existing = await api<{ name: string }>(`${root}/labels/${encodeURIComponent(label)}`); if (existing.name !== label) throw new Error('Label unavailable'); }
      }
      await api(`${root}/issues/${pr.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [label] }) });
      for (const attached of current.labels) {
        if (attached.name !== label && statuses.includes(attached.name)) await api(`${root}/issues/${pr.number}/labels/${encodeURIComponent(attached.name)}`, { method: 'DELETE' });
      }

    } catch (error) {
      if (!submitted && progressResult.conclusion === 'cancelled') progressResult = { conclusion: 'failure', title: 'Review processing failed' };
      throw error;
    } finally {
      if (progress && (submitted || await api<Review[]>(`${path}/reviews?per_page=100`).then(items => ownsPendingReview(items, bot, pr.head.sha, pendingId)).catch(() => false))) await progress.finish(progressResult.conclusion, progressResult.title);
      if (!submitted) {
        try {
          const pending = await api<Review>(`${path}/reviews/${pendingId}`);
          if (pending.state === 'PENDING' && pending.user.login === bot && pending.body?.includes('<!-- oddmash-review-lock -->')) await api(`${path}/reviews/${pendingId}`, { method: 'DELETE' });
        } catch { console.error('Pending review cleanup failed'); }
      }
      if (target.requestComment && (eyesId || requestApproved) && !await completeCommentReaction(api, repository, target.requestComment, eyesId, requestApproved)) {
        throw new Error('Review completion reaction unavailable');
      }
    }
  }
}
