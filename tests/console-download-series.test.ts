import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadSeries } from '../apps/console/src/download-series.ts';

test('weekly and monthly chart periods use observed dates and distinguish zero from missing',()=>{
  const history=[{day:'2026-01-02',downloads:0},{day:'2025-12-30',downloads:10},{day:'2026-01-03',downloads:7}];
  const week=downloadSeries(history,7);
  assert.equal(week.points[0].day,'2025-12-28');
  assert.equal(week.points.at(-1)?.day,'2026-01-03');
  assert.equal(week.points.find(point=>point.day==='2026-01-02')?.downloads,0);
  assert.equal(week.points.find(point=>point.day==='2026-01-01')?.downloads,null);
  assert.equal(week.total,17);
  assert.equal(week.missing,4);
  assert.equal(week.max,10);
  assert.equal(downloadSeries(history,30).points.length,30);
  assert.equal(downloadSeries([],7).total,null);
});
test('all zero results retain the observed total while missing dates remain unknown',()=>{
  const result=downloadSeries([{day:'2026-01-01',downloads:0},{day:'2026-01-03',downloads:0}],7);
  assert.equal(result.total,0);
  assert.equal(result.missing,5);
  assert.equal(result.points.filter(point=>point.downloads===0).length,2);
});
