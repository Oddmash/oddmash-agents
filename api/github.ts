import { waitUntil } from '@vercel/functions';
import { route, validSignature } from '../src/webhook.ts';
import { reviewWebhook } from '../src/webhook-review.ts';

export function GET() {
  return Response.json({ service: 'Oddmash Reviewer', status: 'ok' });
}

export async function POST(request: Request) {
  const secret = process.env.REVIEWER_WEBHOOK_SECRET ?? '';
  if (!secret) return new Response('Unavailable', { status: 503 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 1_000_000) return new Response('Too large', { status: 413 });
  if (!validSignature(bytes, request.headers.get('x-hub-signature-256'), secret)) return new Response('Unauthorized', { status: 401 });
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response('Bad request', { status: 400 }); }
  if (!payload || typeof payload !== 'object') return new Response('Bad request', { status: 400 });
  const target = route(request.headers.get('x-github-event'), payload);
  if (!target) return new Response('Ignored', { status: 200 });
  const config = { appId: process.env.REVIEWER_APP_ID ?? '', key: process.env.REVIEWER_APP_PRIVATE_KEY ?? '', slug: process.env.REVIEWER_APP_SLUG ?? '', openaiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? 'gpt-5.4' };
  if (process.env.REVIEWER_APP_ENABLED !== 'true' || !config.appId || !config.key || !config.slug || !config.openaiKey) return new Response('Unavailable', { status: 503 });
  waitUntil(reviewWebhook(target, config).catch(() => console.error('Webhook review failed')));
  return new Response('Accepted', { status: 202 });
}
