import type { Target } from './webhook.ts';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const reviewTopic = 'oddmash-review-jobs';
export const deadLetterTopic = 'oddmash-review-failed';
export type ReviewJob = { version: 1; delivery: string; target: Target; signature: string };

export function createReviewJob(delivery: string, target: Target, secret: string): ReviewJob {
  if (!secret || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(delivery)) throw new Error('Invalid delivery ID');
  const signature = createHmac('sha256', secret).update(JSON.stringify([1, delivery, target])).digest('hex');
  return { version: 1, delivery, target, signature };
}

export function verifyReviewJob(job: ReviewJob, secret: string): boolean {
  if (job?.version !== 1 || !/^[a-f0-9]{64}$/.test(job.signature ?? '')) return false;
  try { return timingSafeEqual(Buffer.from(job.signature, 'hex'), Buffer.from(createReviewJob(job.delivery, job.target, secret).signature, 'hex')); }
  catch { return false; }
}

export function retryableJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  if (/quota|credit limit|missing app configuration|installation not eligible|repository not eligible|invalid delivery/i.test(message)) return false;
  const status = /(?:GitHub|Model) request failed \((\d{3})\)/.exec(message)?.[1];
  return !status || Number(status) >= 500 || ['408', '409', '429'].includes(status);
}

export function retryDelay(deliveryCount: number) {
  return Math.min(300, 15 * 2 ** Math.max(0, deliveryCount - 1));
}
