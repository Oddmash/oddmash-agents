import { consoleApi } from '../auth.ts';

export const GET = (request: Request) => consoleApi.fetch(request);
export const POST = (request: Request) => consoleApi.fetch(request);
