import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewTarget } from '../src/routing.ts';

test('routes only explicitly allowed public PRs', () => {
  assert.deepEqual(reviewTarget('Oddmash/oddmash-ui', '25'), { repository: 'Oddmash/oddmash-ui', number: 25 });
  assert.deepEqual(reviewTarget('Oddmash/boundra', '42'), { repository: 'Oddmash/boundra', number: 42 });
  assert.equal(reviewTarget('', ''), null);
  for (const pair of [['Oddmash/cash-out', '1'], ['someone/else', '2'], ['Oddmash/oddmash-ui', '0'], ['Oddmash/oddmash-ui', '1.5'], ['', '1'], ['Oddmash/oddmash-ui', '']]) assert.throws(() => reviewTarget(pair[0], pair[1]));
});
