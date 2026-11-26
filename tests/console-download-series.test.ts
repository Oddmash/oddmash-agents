import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadSeries, hasMonthlyHistory } from '../apps/console/src/download-series.ts';

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

test('monthly buckets distinguish missing and zero, partial endpoints and old observations', () => {
  const history = [{day:'2025-12-31',downloads:4},{day:'2026-01-01',downloads:0},{day:'2026-01-31',downloads:2},{day:'2026-02-01',downloads:6}];
  assert.equal(hasMonthlyHistory(history),true);
  const result = downloadSeries(history,'monthly');
  assert.deepEqual(result.points,[{day:'2025-12-01',downloads:4,partial:true},{day:'2026-01-01',downloads:2,partial:true},{day:'2026-02-01',downloads:6,partial:true}]);
  assert.equal(result.total,12);
  assert.equal(result.missing,29);
  assert.equal(hasMonthlyHistory([{day:'2025-12-01',downloads:0},{day:'2026-01-01',downloads:1}]),false);
  assert.deepEqual(downloadSeries([{day:'2026-01-01',downloads:2}],'monthly').points,[]);
});
test('monthly UTC buckets handle leap years and a fully missing month', () => {
  const history = [{day:'2024-01-01',downloads:1},{day:'2024-03-31',downloads:0}];
  const result = downloadSeries(history,'monthly');
  assert.equal(result.points[1].downloads,null);
  assert.equal(result.points[2].downloads,0);
  assert.equal(result.missing,89);
});

test('monthly eligibility is a date span rather than a number of daily observations', () => {
  assert.equal(hasMonthlyHistory([{day:'2025-10-01',downloads:1},{day:'2025-10-31',downloads:0}]),true);
  assert.equal(hasMonthlyHistory([{day:'2025-10-01',downloads:1},{day:'2025-10-30',downloads:0}]),false);
});
