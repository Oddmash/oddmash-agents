import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContributorPulls, readContributorPulls, parseReviewEvidence, parseWorkflowEvidence, parseWorkflowFailures, parseReviewStatus } from '../apps/console/contributor-pulls.ts';
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
  assert.equal(urls.length,5);
  assert.equal(result.pulls[0].evidence?.reviews[0]?.currentHead,true);
  assert.equal(result.pulls[0].evidence?.workflow.state,'unknown');
});

test('rerun attempt supersedes previous failure and latest jobs describe the failing step', () => {
  const parse = (workflow_runs: unknown[]) => parseWorkflowEvidence({total_count:workflow_runs.length,workflow_runs},head,42);
  assert.deepEqual(parse([{...run,run_attempt:1,conclusion:'failure'},{...run,run_attempt:2,status:'in_progress',conclusion:null}]),{state:'running',id:71,attempt:2});
  assert.deepEqual(parseWorkflowFailures({jobs:[{id:72,run_id:71,name:'extension',conclusion:'failure',steps:[{name:'Build',conclusion:'success'},{name:'Chromium extension E2E',conclusion:'failure'}]},{id:73,run_id:99,name:'unrelated',conclusion:'failure'}]},71),[{job:'extension',jobId:72,conclusion:'failure',step:'Chromium extension E2E'}]);
});
test('verified Lead status overrides misleading retained completion only for the current head', () => {
  const comment = {id:91,user:{id:360059368,type:'Bot'},updated_at:row.updated_at,body:'<!-- oddmash-automation-status:review -->\n**Review processing failed**\n\nRequired CI checks did not pass.\n\nCommit: `'+head.sha.slice(0,12)+'`'};
  assert.deepEqual(parseReviewStatus([comment],head.sha),{state:'failed',id:91,updatedAt:row.updated_at,reason:'checks-failed'});
  assert.equal(parseReviewStatus([{...comment,user:{id:42,type:'Bot'}}],head.sha),undefined);
  assert.equal(parseReviewStatus([comment],'b'.repeat(40)),undefined);
});

test('optional enrichment cannot exhaust the search reserve and cached lists retain original observation time', async () => {
  const calls: string[] = [];
  const start = Date.now();
  const items = Array.from({length:4},(_,i)=>({...row, number:42+i}));
  const fake: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.pathname === '/search/issues') return Response.json({items,total_count:4,incomplete_results:false});
    const detail = /\/pulls\/(\d+)$/.exec(url.pathname);
    if (detail) return Response.json({number:Number(detail[1]),head:{sha:head.sha,ref:head.branch,repo:{id:head.repositoryId}},base:{repo:{full_name:'Oddmash/oddmash-ui',private:false}}});
    if (url.pathname.endsWith('/reviews') || url.pathname.endsWith('/comments')) return Response.json([]);
    return Response.json({total_count:0,workflow_runs:[]});
  };
  const original = Date.now;
  try {
    let now = start;
    Date.now = () => now;
    const first = await readContributorPulls('700',fake);
    now += 61_000;
    const cachedSearch = await readContributorPulls('700',fake);
    assert.equal(cachedSearch.observedAt,first.observedAt);
    for(let i=0;i<9;i++){now += 5*60_000+1000; const result=await readContributorPulls('700',fake); assert.equal(result.pulls.length,4);}
    assert(calls.length <= 50);
    assert(calls.filter(path=>path.endsWith('/reviews') || path.endsWith('/comments')).length <= 18);
    assert(calls.filter(path=>path==='/search/issues').length >= 2);
  } finally { Date.now=original; }
});
