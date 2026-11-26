import assert from 'node:assert/strict';
import test from 'node:test';
import { toggleTargetSelection, visibleTargetSelection } from '../apps/console/src/target-selection.ts';

const first = { key: 'oddmash/a#1', target: { repository: 'Oddmash/a', number: 1 } };
const second = { key: 'oddmash/b#2', target: { repository: 'Oddmash/b', number: 2 } };
const unknown = { key: 'unreported', target: undefined };

test('only one identified target is expanded by default and explicit choices persist across updates', () => {
  assert.equal(visibleTargetSelection([unknown, first, second], undefined), first.key);
  assert.equal(visibleTargetSelection([second, first], first.key), first.key);
  assert.equal(visibleTargetSelection([second], first.key), second.key);
  assert.equal(visibleTargetSelection([unknown], first.key), undefined);
  assert.equal(visibleTargetSelection([first, second], null), null);
  assert.equal(toggleTargetSelection(first.key, second.key), second.key);
  assert.equal(toggleTargetSelection(second.key, second.key), null);
});
