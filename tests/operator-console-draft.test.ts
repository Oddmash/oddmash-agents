import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultControls } from '../packages/operator-contract/src/controls.ts';
import { controlsDirty, displayLimit, readLimitInput, validControlLimits } from '../apps/console/src/control-draft.ts';

test('inherited limits display actual deployment defaults without materializing overrides', () => {
  const draft = defaultControls();
  assert.equal(displayLimit(draft.maxRequests, 5), 5);
  assert.equal(displayLimit(draft.maxMs, 90000, 1000), 90);
  assert.equal(displayLimit(null, undefined), '');
  assert.equal(displayLimit(0, 5), 0);
  assert.equal(controlsDirty(defaultControls(), draft), false);
});

test('invalid draft limits never become implicit inheritance or exceed the deployment cap', () => {
  const draft = defaultControls();
  const defaults = { maxRequests: 4, maxMs: 90000 };
  assert.equal(validControlLimits(draft, defaults), true);
  assert.equal(validControlLimits({ ...draft, maxRequests: 5 }, defaults), false);
  assert.equal(validControlLimits({ ...draft, maxMs: 91000 }, defaults), false);
  assert.equal(validControlLimits({ ...draft, maxRequests: NaN }, defaults), false);
  assert.equal(displayLimit(NaN, 5), '');
  assert.equal(controlsDirty(draft, { ...draft, maxRequests: NaN }), true);
  assert.equal(validControlLimits({ ...draft, maxRequests: 0, maxMs: 0 }, defaults), true);
});

test('clearing a limit restores inheritance while malformed input stays invalid', () => {
  assert.equal(readLimitInput('', NaN, false), null);
  assert.equal(readLimitInput('', NaN, false, 1000), null);
  assert.ok(Number.isNaN(readLimitInput('', NaN, true)));
  assert.equal(readLimitInput('0', 0, false), 0);
  assert.equal(validControlLimits({ ...defaultControls(), maxRequests: readLimitInput('1.5', 1.5, false) }, { maxRequests: 5 }), false);
  assert.equal(readLimitInput('90.5', 90.5, false, 1000), 90500);
});
