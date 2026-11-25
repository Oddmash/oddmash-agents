import type { NextRequest } from 'next/server';
import { authConfigured, handlers } from '../../../../auth';

export const dynamic = 'force-dynamic';
export const GET = (request: NextRequest) => authConfigured() ? handlers.GET(request) : new Response('Unavailable', { status: 503 });
export const POST = (request: NextRequest) => authConfigured() ? handlers.POST(request) : new Response('Unavailable', { status: 503 });
