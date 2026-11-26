import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNpmHistory, parseMarketplaceCount, collectAdoptionMetrics, readAdoptionMetrics } from '../apps/console/adoption-metrics.ts';
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
    const id = url.pathname.split('/last-month/')[1];
    return Response.json({package:id, downloads:[{day:'2026-11-25',downloads:0}]});
  };
  const result = await collectAdoptionMetrics(request,new Date('2026-11-26T00:00:00Z'));
  assert.equal(result.length,4);
  assert.equal(result[0].count,0);
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
