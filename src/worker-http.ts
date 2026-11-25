import { Hono } from 'hono';

export function workerEndpoint(path: string, post: (request: Request) => Promise<Response>, health?: () => Response) {
  const app = new Hono();
  if (health) app.get(path, () => health());
  app.post(path, c => post(c.req.raw));
  app.onError((_error, c) => c.text('Unavailable', 503));
  return app;
}
