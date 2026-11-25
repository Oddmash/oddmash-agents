import { serve } from '@hono/node-server';
import { consoleApi } from './auth.ts';

serve({ fetch: consoleApi.fetch, hostname: '127.0.0.1', port: 4312 });
