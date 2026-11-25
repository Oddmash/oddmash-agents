import { authConfigured, handlers } from '../../../../auth';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => authConfigured() ? handlers.GET(request) : new Response('Unavailable', { status: 503 });
export const POST = (request: Request) => authConfigured() ? handlers.POST(request) : new Response('Unavailable', { status: 503 });
