import test from 'node:test';
import assert from 'node:assert/strict';
import { readSharedGuidance, type GuidanceCache } from '../apps/worker/src/shared-guidance.ts';
import { authorizePublicGuidance, type Target } from '../apps/worker/src/webhook.ts';
import { createHash, generateKeyPairSync } from 'node:crypto';

test('authenticated shared guidance uses conditional freshness and does not serve stale data on denial', async () => {
  const cache: GuidanceCache = new Map();
  const token = 'fixture-guidance-token';
  let count = 0;
  const request: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.github.com/repos/Oddmash/.github/contents/AGENTS.md?ref=main');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer ' + token);
    count++;
    if (count === 1) return Response.json({ content: 'YWJj', encoding: 'base64', type: 'file', path: 'AGENTS.md', size: 3, sha: createHash('sha1').update('blob 3\0abc').digest('hex') }, { headers: { etag: '"fixture-etag"' } });
    assert.equal(headers.get('If-None-Match'), '"fixture-etag"');
    if (count === 2) return new Response(null, { status: 304 });
    return new Response(null, { status: 403 });
  };
  assert.equal((await readSharedGuidance('AGENTS.md', token, request, cache))?.content, 'YWJj');
  assert.equal((await readSharedGuidance('AGENTS.md', token, request, cache))?.content, 'YWJj');
  await assert.rejects(readSharedGuidance('AGENTS.md', token, request, cache), /GitHub request failed \(403\)/);
  assert.equal(count, 3);
  assert.equal(cache.size, 0);
});

test('unauthenticated lookup does not reuse a cached authenticated body', async () => {
  const cache: GuidanceCache = new Map([['AGENTS.md', { etag: '"fixture"', data: { content: 'YWJj', encoding: 'base64' }, tokenKey: createHash('sha256').update('fixture-token').digest('hex'), until: Date.now() + 600000 }]]);
  const result = await readSharedGuidance('AGENTS.md', undefined, async (_url, init) => {
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    assert.equal(new Headers(init?.headers).has('If-None-Match'), false);
    return new Response(null, { status: 404 });
  }, cache);
  assert.equal(result, null);
});

test('guidance authorization requests read-only access solely to the canonical public repository', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const target: Target = { installation: 56, repository: 'Oddmash/example', repositoryId: 100 };
  const result = await authorizePublicGuidance(target, '1234', key, async (input, init) => {
    const url = String(input);
    if (url.endsWith('/app/installations/56')) return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
    if (url.endsWith('/access_tokens')) {
      assert.deepEqual(JSON.parse(String(init?.body)), { repository_ids: [1455305553], permissions: { contents: 'read' } });
      return Response.json({ token: 'fixture-token', expires_at: new Date(Date.now() + 3600000).toISOString(), permissions: { contents: 'read' } });
    }
    assert.equal(url, 'https://api.github.com/repos/Oddmash/.github');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token');
    return Response.json({ id: 1455305553, full_name: 'Oddmash/.github', private: false, owner: { login: 'Oddmash' } });
  });
  assert.equal(result, 'fixture-token');
});

test('authenticated cache rejects an invalid cached blob even on 304', async () => {
  const cache: GuidanceCache = new Map([['AGENTS.md', { etag: '"fixture"', data: { content: 'YWJj', encoding: 'base64', type: 'file', path: 'AGENTS.md', size: 3, sha: 'a'.repeat(40) }, tokenKey: createHash('sha256').update('fixture-token').digest('hex'), until: Date.now() + 600000 }]]);
  await assert.rejects(readSharedGuidance('AGENTS.md', 'fixture-token', async () => new Response(null, { status: 304 }), cache), /integrity unavailable/);
  assert.equal(cache.size, 0);
});

test('cache validators are isolated by token and absolute age', async () => {
  const cache: GuidanceCache = new Map();
  const original = 'fixture-token';
  const body = { content: 'YWJj', encoding: 'base64', type: 'file', path: 'AGENTS.md', size: 3, sha: createHash('sha1').update('blob 3\0abc').digest('hex') };
  await readSharedGuidance('AGENTS.md', original, async () => Response.json(body, { headers: { etag: '"fixture"' } }), cache);
  const request: typeof fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).has('if-none-match'), false);
    return Response.json(body, { headers: { etag: '"fixture"' } });
  };
  await readSharedGuidance('AGENTS.md', 'different-fixture-token', request, cache);
  const entry = cache.get('AGENTS.md')!;
  entry.until = Date.now() - 1;
  await readSharedGuidance('AGENTS.md', 'different-fixture-token', request, cache);
});

test('concurrent authenticated reads share one validated in-flight request and revalidate later', async () => {
  const cache: GuidanceCache = new Map();
  const token = 'fixture-guidance-token';
  const body = { content: 'YWJj', encoding: 'base64', type: 'file', path: 'AGENTS.md', size: 3, sha: createHash('sha1').update('blob 3\0abc').digest('hex') };
  let calls = 0;
  const request: typeof fetch = async (_url, init) => {
    calls++;
    await Promise.resolve();
    if (calls === 1) return Response.json(body, { headers: { etag: '"fixture"' } });
    assert.equal(new Headers(init?.headers).get('if-none-match'), '"fixture"');
    return new Response(null, { status: 304 });
  };
  const [first, second] = await Promise.all([
    readSharedGuidance('AGENTS.md', token, request, cache),
    readSharedGuidance('AGENTS.md', token, request, cache),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first?.content, 'YWJj');
  assert.equal(calls, 1);
  assert.equal((await readSharedGuidance('AGENTS.md', token, request, cache))?.content, 'YWJj');
  assert.equal(calls, 2);
});

test('failed coalesced read does not retain an in-flight rejection', async () => {
  const cache: GuidanceCache = new Map();
  const token = 'fixture-guidance-token';
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return new Response(null, { status: 403 });
  };
  const results = await Promise.allSettled([
    readSharedGuidance('AGENTS.md', token, request, cache),
    readSharedGuidance('AGENTS.md', token, request, cache),
  ]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(calls, 1);
  assert.equal(cache.size, 0);
  await assert.rejects(readSharedGuidance('AGENTS.md', token, request, cache));
  assert.equal(calls, 2);
});
