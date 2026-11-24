import { setTimeout } from 'node:timers/promises';

type Api = ReturnType<typeof import('./webhook.ts').githubApi>;
export type Review = { id: number; node_id?: string; body: string | null; user: { login: string }; state: string; commit_id: string };

async function readLockReviews(api: Api, path: string, bot: string): Promise<Review[]> {
  const own: Review[] = [];
  for (let page = 1; page <= 10; page++) {
    const reviews = await api<Review[]>(`${path}/reviews?per_page=100&page=${page}`);
    own.push(...reviews.filter(review => review.user.login === bot));
    if (reviews.length < 100) return own;
  }
  throw new Error('Pending review lookup incomplete');
}

export async function acquirePendingReview(api: Api, path: string, head: string, bot: string, webhook = false): Promise<number | null> {
  try {
    const body = '<!-- oddmash-review-lock -->' + (webhook ? `\n<!-- oddmash-webhook-lock:${Date.now()} -->` : '');
    const pending = await api<Review>(`${path}/reviews`, { method: 'POST', body: JSON.stringify({ commit_id: head, body }) });
    if (pending.state !== 'PENDING' || pending.user.login !== bot || !Number.isSafeInteger(pending.id)) throw new Error('Unexpected pending review response');
    return pending.id;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('(422)')) throw error;
    const reviews = await readLockReviews(api, path, bot);
    if (reviews.some(review => review.state === 'PENDING' || review.commit_id === head && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state))) return null;
    throw error;
  }
}

export function ownsPendingReview(reviews: Review[], bot: string, head: string, id: number): boolean {
  if (reviews.length >= 100) return false;
  const pending = reviews.filter(review => review.user.login === bot && review.state === 'PENDING');
  const own = pending.find(review => review.id === id);
  return !!own && own.commit_id === head && !!own.body?.includes('<!-- oddmash-review-lock -->') && pending.every(review => Number.isSafeInteger(review.id) && review.id >= id && review.commit_id === head && !!review.body?.includes('<!-- oddmash-review-lock -->'));
}

export function expiredWebhookLock(review: Review, bot: string, now = Date.now()): boolean {
  const timestamp = Number(review.body?.match(/<!-- oddmash-webhook-lock:(\d{13}) -->/)?.[1]);
  return review.state === 'PENDING' && review.user.login === bot && !!review.body?.includes('<!-- oddmash-review-lock -->') && Number.isSafeInteger(timestamp) && now - timestamp > 360_000;
}

export async function clearExpiredWebhookLock(api: Api, path: string, review: Review, bot: string): Promise<boolean> {
  if (!expiredWebhookLock(review, bot)) return false;
  const current = await api<Review>(`${path}/reviews/${review.id}`);
  if (current.id !== review.id || current.commit_id !== review.commit_id || current.body !== review.body || !expiredWebhookLock(current, bot)) return false;
  await api(`${path}/reviews/${review.id}`, { method: 'DELETE' });
  return true;
}

export async function withPendingReviewLock(api: Api, path: string, head: string, bot: string, action: () => Promise<void>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const pending = (await readLockReviews(api, path, bot)).find(review => review.state === 'PENDING');
    const busy = pending && !await clearExpiredWebhookLock(api, path, pending, bot);
    const id = busy ? null : await acquirePendingReview(api, path, head, bot, true);
    if (id !== null) {
      try {
        const owned = (await readLockReviews(api, path, bot)).filter(review => review.state === 'PENDING');
        if (ownsPendingReview(owned, bot, head, id)) {
          await action();
          return;
        }
      } finally {
        const reviewPath = `${path}/reviews/${id}`;
        try {
          const review = await api<Review>(reviewPath);
          if (review.state === 'PENDING' && review.user.login === bot && review.commit_id === head &&
              review.body?.includes('<!-- oddmash-review-lock -->')) await api(reviewPath, { method: 'DELETE' });
        } catch {
          console.warn('Discussion review lock cleanup failed');
        }
      }
    }
    if (attempt < 3) await setTimeout(500);
  }
  throw new Error('Pending review active');
}
