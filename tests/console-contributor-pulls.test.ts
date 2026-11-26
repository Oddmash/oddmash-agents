import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContributorPulls, readContributorPulls, parseReviewEvidence, parseWorkflowEvidence } from '../apps/console/contributor-pulls.ts';
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
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    if (url.pathname !== '/search/issues') return new Response('', {status: 503});
    assert.equal(url.searchParams.get('q'), 'org:Oddmash is:pr is:open is:public');
    assert.equal(url.searchParams.get('per_page'), '100');
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
  assert.equal(calls,3);
  assert.deepEqual(a,b);
  await readContributorPulls('789',fake);
  assert.equal(calls,3);
});

const head = {sha:'a'.repeat(40),repositoryId:8,branch:'feature'};
const review = {id:91,user:{id:360059368,type:'Bot'},state:'APPROVED',commit_id:head.sha,submitted_at:row.updated_at};
test('read evidence uses verified bot identity and exact review revision', () => {
  assert.deepEqual(parseReviewEvidence([review, {...review,id:92,user:{id:99,type:'Bot'}},{...review,id:93,user:{id:360059368,type:'User'}}],head.sha), [{role:'reviewer',state:'APPROVED',currentHead:true,submittedAt:row.updated_at,id:91}]);
  assert.equal(parseReviewEvidence([review], 'b'.repeat(40))[0].currentHead,false);
});
const run = {id:71,workflow_id:7,head_sha:head.sha,event:'pull_request',head_repository:{id:head.repositoryId},head_branch:head.branch,pull_requests:[],status:'completed',conclusion:'action_required'};
test('workflow status distinguishes exact fork head approval, generic waiting, unrelated runs and superseded actions', () => {
  const parse = (workflow_runs: unknown[]) => parseWorkflowEvidence({total_count:workflow_runs.length,workflow_runs},head,42);
  assert.deepEqual(parse([run]),{state:'action-required',id:71});
  assert.deepEqual(parse([{...run,status:'waiting',conclusion:null}]),{state:'waiting',id:71});
  assert.deepEqual(parse([{...run,pull_requests:[{number:43}]}]),{state:'unknown'});
  assert.deepEqual(parse([{...run,head_sha:'b'.repeat(40)}]),{state:'unknown'});
  assert.deepEqual(parse([run,{...run,id:72,conclusion:'success'}]),{state:'reported'});
});
test('enrichment remains bounded to public exact targets and retains partial evidence', async () => {
  const urls: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url.pathname);
    assert.equal(new Headers(init?.headers).has('authorization'),false);
    if (url.pathname === '/search/issues') return Response.json({items:[row],total_count:1,incomplete_results:false});
    if (url.pathname.endsWith('/pulls/42')) return Response.json({number:42,head:{sha:head.sha,ref:head.branch,repo:{id:head.repositoryId}},base:{repo:{full_name:'Oddmash/oddmash-ui',private:false}}});
    if (url.pathname.endsWith('/reviews')) return Response.json([review]);
    assert.equal(url.searchParams.get('head_sha'),head.sha);
    return new Response('',{status:429});
  };
  const result = await readContributorPulls('999',fake);
  assert.equal(urls.length,4);
  assert.equal(result.pulls[0].evidence?.reviews[0]?.currentHead,true);
  assert.equal(result.pulls[0].evidence?.workflow.state,'unknown');
});
