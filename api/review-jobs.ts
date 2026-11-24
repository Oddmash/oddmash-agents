import { executionContext, executionRole, runAgentExecution } from '../src/agent-execution.ts';
import { handleCallback, send } from '@vercel/queue';
import { runtimeConfig, advisoryConfig } from '../src/runtime-config.ts';
import { verifyReviewJob, deadLetterTopic, publishFailureRecord, retryableJobError, retryDelay, type ReviewJob } from '../src/review-job.ts';
import { reviewWebhook } from '../src/webhook-review.ts';

export const POST = handleCallback(async (message: ReviewJob, metadata) => {
  const identity = message?.target?.advisoryIdentity;
  const dedicated = identity ? advisoryConfig(identity) : null;
  const config = identity ? dedicated : runtimeConfig();
  if (!config || process.env.REVIEWER_QUEUE_ENABLED !== 'true') throw new Error('Missing app configuration');
  if (!verifyReviewJob(message, identity ? dedicated?.secret ?? '' : process.env.REVIEWER_WEBHOOK_SECRET ?? '') || (identity && message.target.advisory !== identity)) { console.error('Invalid reviewer queue message'); return; }
  const job = message;
  try {
    await runAgentExecution(executionContext(executionRole(job.target), job.delivery, metadata.deliveryCount), () => reviewWebhook(job.target, config));
  } catch (error) {
    if (retryableJobError(error) && metadata.deliveryCount < 4) throw error;
    await publishFailureRecord(() => send(deadLetterTopic, { version: 1, delivery: job.delivery, target: job.target, attempts: metadata.deliveryCount, reason: retryableJobError(error) ? 'retry-limit' : 'permanent' }, { idempotencyKey: job.delivery, retentionSeconds: 86400 }), message => console.error(message));
    console.error('Reviewer job requires maintainer attention');
  }
}, { retry: (error, metadata) => metadata.deliveryCount >= 5 || !retryableJobError(error) ? { acknowledge: true } : { afterSeconds: error instanceof Error && error.message === 'Pending review active' ? 120 : retryDelay(metadata.deliveryCount) } });
