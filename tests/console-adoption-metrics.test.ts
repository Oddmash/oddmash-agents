import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNpmHistory, parseMarketplaceCount, collectAdoptionMetrics, readAdoptionMetrics, createAdoptionReader } from '../apps/console/adoption-metrics.ts';
test('npm daily counts preserve zero and reject invalid, duplicate or mismatched data', () => {
  const history = [{day:'2026-11-24',downloads:0},{day:'2026-11-25',downloads:3}];
  assert.deepEqual(parseNpmHistory({package:'boundra',downloads:history},'boundra'),history);
  assert.throws(()=>parseNpmHistory({package:'other',downloads:history},'boundra'));
  assert.throws(()=>parseNpmHistory({package:'boundra',downloads:[...history,history[0]]},'boundra'));
  assert.throws(()=>parseNpmHistory({package:'boundra',downloads:[{day:'2026-11-31',downloads:2}]},'boundra'));
});
test('Marketplace count is the exact publisher extension install statistic', () => {
  const payload = {results:[{extensions:[{publisher:{publisherName:'oddmash'},extensionName:'boundra-vscode',statistics:[{statisticName:'install',value:0},{statisticName:'downloadCount',value:99}]}]}]};
  assert.equal(parseMarketplaceCount(payload),0);
  assert.throws(()=>parseMarketplaceCount({results:[]}));
  assert.throws(()=>parseMarketplaceCount({results:[{extensions:[{...payload.results[0].extensions[0],publisher:{publisherName:'other'}}]}]}));
});
test('provider failure is unavailable, separate from successful zero; no credentials are sent', async () => {
  const request: typeof fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).has('authorization'),false);
    const url = new URL(String(input));
    if(url.hostname==='marketplace.visualstudio.com') return new Response('',{status:429});
    if(url.pathname.endsWith('/@oddmash/juliya')) return Response.json({error:'package not found'},{status:404});
    const id = url.pathname.split('/last-month/')[1];
    return Response.json({package:id, downloads:[{day:'2026-11-25',downloads:0}]});
  };
  const result = await collectAdoptionMetrics(request,new Date('2026-11-26T00:00:00Z'));
  assert.equal(result.length,4);
  assert.equal(result[0].count,0);
  assert.equal(result[1].count,null);
  assert.equal(result[1].history,null);
  assert.equal(result[3].count,null);
  assert.equal(result[3].history,null);
});

test('console reads share an in-flight public snapshot and reuse it', async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return new Response('', {status:429}); };
  const [a,b] = await Promise.all([readAdoptionMetrics(request),readAdoptionMetrics(request)]);
  assert.equal(calls,4);
  assert.deepEqual(a,b);
  assert.ok(a.every(metric => metric.count === null));
  await readAdoptionMetrics(request);
  assert.equal(calls,4);
});

test('only expired provider observations are retried; successful values remain cached', async () => {
  let now = Date.parse('2026-11-26T00:00:00Z');
  const calls: string[] = [];
  const read = createAdoptionReader(()=>now);
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    const id = url.hostname === 'marketplace.visualstudio.com' ? 'marketplace' : url.pathname.split('/last-year/')[1];
    calls.push(id);
    if(id==='@oddmash/juliya') return new Response('',{status:404});
    if(id==='marketplace') return Response.json({results:[{extensions:[{publisher:{publisherName:'oddmash'},extensionName:'boundra-vscode',statistics:[{statisticName:'install',value:9}]}]}]});
    return Response.json({package:id,downloads:[{day:'2026-11-25',downloads:3}]});
  };
  const first=await read(request);
  assert.equal(calls.length,4);
  now+=60_000;
  const second=await read(request);
  assert.deepEqual(calls.slice(4),['@oddmash/juliya']);
  assert.deepEqual(second.filter(metric=>metric.count!==null),first.filter(metric=>metric.count!==null));
  now+=3_540_000;
  await read(request);
  assert.equal(calls.length,9);
});

test('live console retains bounded longer npm history but the displayed total remains the recent 30 days', async () => {
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    assert.match(url.pathname,/last-year/);
    return Response.json({package:'boundra',downloads:[{day:'2025-12-01',downloads:10},{day:'2026-01-01',downloads:2},{day:'2026-01-30',downloads:3}]});
  };
  const [metric] = await collectAdoptionMetrics(request,new Date('2026-01-31'),['boundra'],true);
  assert.equal(metric.count,5);
  assert.equal(metric.history?.length,3);
  assert.throws(()=>parseNpmHistory({package:'boundra',downloads:[{day:'2024-01-01',downloads:1},{day:'2026-01-01',downloads:2}]},'boundra',366));
});

test('stale annual observations remain history without masquerading as recent downloads', async () => {
  const request: typeof fetch = async () => Response.json({package:'boundra',downloads:[{day:'2025-10-01',downloads:2},{day:'2025-10-31',downloads:5}]});
  const [metric] = await collectAdoptionMetrics(request,new Date('2026-01-31'),['boundra'],true);
  assert.equal(metric.count,null);
  assert.equal(metric.history?.length,2);
});
