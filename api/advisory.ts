import { workerEndpoint } from '../src/worker-http.ts';
import { executionContext, recordQueued, runAgentExecution } from '../src/agent-execution.ts';
import { waitUntil } from '@vercel/functions';
import { send } from '@vercel/queue';
import { advisoryConfig } from '../src/runtime-config.ts';
import { isAdvisoryRole } from '../src/advisory-agents.ts';
import { dedicatedAdvisoryTarget, validSignature } from '../src/webhook.ts';
import { createReviewJob, reviewTopic } from '../src/review-job.ts';
import { reviewWebhook } from '../src/webhook-review.ts';

async function receive(request: Request) {
  const role = new URL(request.url).searchParams.get('agent');
  if (!isAdvisoryRole(role)) return new Response('Not found', { status: 404 });
  const config = advisoryConfig(role);
  if (!config) return new Response('Unavailable', { status: 503 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 1_000_000) return new Response('Too large', { status: 413 });
  if (!validSignature(bytes, request.headers.get('x-hub-signature-256'), config.secret)) return new Response('Unauthorized', { status: 401 });
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response('Bad request', { status: 400 }); }
  if (!payload || typeof payload !== 'object') return new Response('Ignored', { status: 200 });
  const delivery = request.headers.get('x-github-delivery') ?? '';
  const target = dedicatedAdvisoryTarget(request.headers.get('x-github-event'), payload, role, config.slug, delivery);
  if (!target) return new Response('Ignored', { status: 200 });
  const execution = executionContext(role, delivery, 1, target);
  if (process.env.REVIEWER_QUEUE_ENABLED === 'true') {
    let job;
    try { job = createReviewJob(delivery, target, config.secret); } catch { return new Response('Bad request', { status: 400 }); }
    try { await send(reviewTopic, job, { idempotencyKey: `${role}:${delivery}`, retentionSeconds: 86400 }); }
    catch { return new Response('Unavailable', { status: 503 }); }
    waitUntil(recordQueued(execution));
  } else waitUntil(runAgentExecution(execution, () => reviewWebhook(target, config)).catch(() => console.error('Advisory job failed')));
  return new Response('Accepted', { status: 202 });
}

const app = workerEndpoint('/api/advisory', receive);
export const POST = (request: Request) => app.fetch(request);
