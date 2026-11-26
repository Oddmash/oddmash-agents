import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, POST } from '../api/[resource].ts';

test('shared adapter keeps read routes owner-only and rejects unsupported resources and methods', async () => {
  const previous = process.env.CONSOLE_SESSION_MODE;
  process.env.CONSOLE_SESSION_MODE = 'legacy';
  const origin = 'https://console.example.test';
  try {
    for (const path of ['/api/status','/api/controls','/api/models','/api/contributors','/api/adoption']) {
      const response = await GET(new Request(origin + path));
      assert.equal(response.status,401);
      assert.match(response.headers.get('cache-control') ?? '',/no-store/);
    }
    assert.equal((await GET(new Request(origin+'/api/availability'))).status,200);
    assert.equal((await GET(new Request(origin+'/api/not-a-console-resource'))).status,404);
    for (const path of ['/api/status','/api/adoption','/api/contributors','/api/availability','/api/github']) assert.equal((await POST(new Request(origin+path,{method:'POST'}))).status,404);
  } finally { if (previous === undefined) delete process.env.CONSOLE_SESSION_MODE; else process.env.CONSOLE_SESSION_MODE = previous; }
});
