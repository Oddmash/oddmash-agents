import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContributorPulls, readContributorPulls } from '../apps/console/contributor-pulls.ts';
import { consoleRoute, localizedCallback } from '../apps/console/src/i18n.ts';
const row = { repository_url: 'https://api.github.com/repos/Oddmash/oddmash-ui', number: 42, title: 'Improve button', state: 'open', draft: false, pull_request: {}, user: { id: 456, login: 'guest', type: 'User' }, author_association: 'CONTRIBUTOR', updated_at: '2026-11-26T00:00:00Z' };
test('external public PR records exclude owner, bots, members, collaborators and other organizations', () => {
  const items = [row, {...row, user: {...row.user, id: 123}}, {...row, user: {...row.user, type: 'Bot'}}, {...row, author_association: 'MEMBER'}, {...row, author_association: 'COLLABORATOR'}, {...row, author_association: 'UNKNOWN'}, {...row, repository_url: 'https://api.github.com/repos/Other/ui'}];
  const result = parseContributorPulls({ items, total_count: items.length, incomplete_results: false }, '123', row.updated_at);
  assert.deepEqual(result.pulls, [{repository:'Oddmash/oddmash-ui', number:42, title:'Improve button', author:'guest', updatedAt:row.updated_at, draft:false}]);
  assert.equal(result.partial, true);
  assert.throws(() => parseContributorPulls({}, '123', row.updated_at));
});
test('public search is fixed, bounded and uses no authorization header', async () => {
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(url.searchParams.get('q'), 'org:Oddmash is:pr is:open is:public');
    assert.equal(url.searchParams.get('per_page'), '100');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({ items:[row], total_count:101, incomplete_results:false });
  };
  const result = await readContributorPulls('123', fake);
  assert.equal(result.partial, true);
  assert.equal(result.pulls.length, 1);
});
test('contributor view supports direct and callback routes', () => {
  assert.equal(consoleRoute('https://example.test/ko/contributors').view, 'contributors');
  assert.equal(localizedCallback('https://example.test','/ko/contributors','ko'),'https://example.test/ko/contributors');
});

test('successful cache is reused for the same owner and failed fetches can be retried', async () => {
  let calls = 0;
  const fake: typeof fetch = async () => {
    calls++;
    if (calls === 1) return new Response('', {status: 429});
    return Response.json({items:[row],total_count:1,incomplete_results:false});
  };
  await assert.rejects(readContributorPulls('789',fake));
  const [a,b] = await Promise.all([readContributorPulls('789',fake),readContributorPulls('789',fake)]);
  assert.equal(calls,2);
  assert.deepEqual(a,b);
  await readContributorPulls('789',fake);
  assert.equal(calls,2);
});
