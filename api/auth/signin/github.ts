import { consoleApi } from '../../../apps/console/auth.ts';

export const POST = (request: Request) => consoleApi.fetch(request);
