import { consoleApi } from '../apps/console/auth.ts';

export const GET = (request: Request) => consoleApi.fetch(request);
