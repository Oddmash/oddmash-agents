import { workerEndpoint } from '../apps/worker/src/worker-http.ts';
import { executionContext, executionRole, recordQueued, runAgentExecution } from '../apps/worker/src/agent-execution.ts';
import { waitUntil } from '@vercel/functions';
import { ignoredReviewRequest, route, validSignature } from '../apps/worker/src/webhook.ts';
import { readExecutionControls, reviewWebhook } from '../apps/worker/src/webhook-review.ts';
import { send } from '@vercel/queue';
import { createReviewJob, leadDeliveryKey, reviewTopic } from '../apps/worker/src/review-job.ts';
import { runtimeConfig } from '../apps/worker/src/runtime-config.ts';

function health() {
  return Response.json({ service: 'Oddmash Reviewer', status: 'ok' });
}

async function receive(request: Request) {
  const secret = process.env.REVIEWER_WEBHOOK_SECRET ?? '';
  if (!secret) return new Response('Unavailable', { status: 503 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 1_000_000) return new Response('Too large', { status: 413 });
  if (!validSignature(bytes, request.headers.get('x-hub-signature-256'), secret)) return new Response('Unauthorized', { status: 401 });
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response('Bad request', { status: 400 }); }
  if (!payload || typeof payload !== 'object') return new Response('Bad request', { status: 400 });
  const event = request.headers.get('x-github-event');
  const slug = process.env.REVIEWER_APP_SLUG ?? '';
  const target = route(event, payload, slug, request.headers.get('x-github-delivery') ?? '');
  if (!target) {
    const reason = ignoredReviewRequest(event, payload, slug);
    if (reason) console.info('Reviewer webhook ignored: ' + reason);
    return new Response(reason ? 'Ignored: ' + reason : 'Ignored', { status: 200 });
  }
  const config = runtimeConfig();
  if (!config) {
    console.error('Reviewer runtime configuration unavailable');
    return new Response('Unavailable', { status: 503 });
  }
  const delivery = request.headers.get('x-github-delivery') ?? '';
  const execution = executionContext(executionRole(target), delivery, 1, target);
  if (process.env.REVIEWER_QUEUE_ENABLED === 'true') {
    let job;
    try { job = createReviewJob(delivery, target, secret); } catch { return new Response('Bad request', { status: 400 }); }
    try { await send(reviewTopic, job, { idempotencyKey: leadDeliveryKey(target, delivery), retentionSeconds: 86400 }); }
    catch { console.error('Reviewer queue publish failed'); return new Response('Unavailable', { status: 503 }); }
    waitUntil(recordQueued(execution));
    if (target.requestComment) console.info('Reviewer comment request queued');
    return new Response('Accepted', { status: 202 });
  }
  let controls;
  try { controls = await readExecutionControls(target); }
  catch {
    console.warn('Review delivery not accepted: operator controls unavailable');
    return new Response('Unavailable', { status: 503 });
  }
  waitUntil(runAgentExecution(execution, () => reviewWebhook(target, config, controls)).catch(error => {
    const message = error instanceof Error ? error.message : '';
    const known = /^(?:GitHub request failed \(\d{3}\)|Model request failed \(\d{3}\)|Incomplete review response|Model input budget exceeded|Unexpected pending review response|Missing app configuration|Installation not eligible|Repository not eligible|Model quota, rate or credit limit reached; stop and check API billing before retrying|Pending review: Unexpected pending review response|Pending review: GitHub request failed \(\d{3}\)|Submit review: GitHub request failed \(\d{3}\))$/;
    console.error('Webhook review failed: ' + (known.test(message) ? message : 'Unexpected error'));
  }));
  if (target.requestComment) console.info('Reviewer comment request accepted');
  return new Response('Accepted', { status: 202 });
}

const app = workerEndpoint('/api/github', receive, health);
export const GET = (request = new Request('https://localhost/api/github')) => app.fetch(request);
export const POST = (request: Request) => app.fetch(request);
