import { test } from 'node:test';
import assert from 'node:assert/strict';
import { korean, chooseLanguage, translate, executionCount, missingCalls, type Message } from '../apps/console/src/i18n.ts';

test('console languages use Korean when selected or negotiated and English otherwise', () => {
  assert.equal(chooseLanguage('ko-KR'), 'ko');
  assert.equal(chooseLanguage('en-US'), 'en');
  assert.equal(chooseLanguage('fr'), 'en');
  assert.equal(chooseLanguage(null), 'en');
  for (const key of Object.keys(korean) as Message[]) {
    assert.equal(translate('en', key), key);
    assert.ok(translate('ko', key).trim());
  }
});

test('console translates dynamic execution counts and missing measurements', () => {
  assert.equal(executionCount('en', 1, 2), '1 of 2 executions');
  assert.equal(executionCount('ko', 1, 2), '전체 2건 중 1건');
  assert.equal(missingCalls('ko', 3), '3건 미측정');
});
