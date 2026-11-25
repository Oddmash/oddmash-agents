import { test } from 'node:test';
import assert from 'node:assert/strict';
import { korean, chooseLanguage, consoleRoute, localizedCallback, localizedUrl, translate, executionCount, missingCalls, type Message } from '../apps/console/src/i18n.ts';

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

test('localized links retain route and other parameters while reflecting the selected language', () => {
  const url = localizedUrl('https://example.test/?lang=ko&view=recent#activity', 'en');
  assert.equal(url.href, 'https://example.test/en/activity?view=recent');
  assert.equal(localizedUrl(url.href, 'en').href, url.href);
});

test('authentication returns only to the explicit console origin, locale and known view', () => {
  assert.equal(localizedCallback('https://example.test', '#activity', 'ko'), 'https://example.test/ko/activity');
  assert.equal(localizedCallback('https://example.test', '#unrecognized', 'en'), 'https://example.test/en');
});

test('canonical routes take precedence over legacy locale and fragments', () => {
  assert.deepEqual(consoleRoute('https://example.test/ko/settings?lang=en#activity'), { language: 'ko', view: 'settings' });
  assert.equal(localizedUrl('https://example.test/ko/settings?lang=en#activity', 'en').href, 'https://example.test/en/settings');
  assert.equal(localizedCallback('https://example.test', '/ko/settings', 'ko'), 'https://example.test/ko/settings');
  assert.equal(localizedCallback('https://example.test', '//other.test/settings', 'ko'), 'https://example.test/ko');
  assert.equal(localizedCallback('https://example.test', '/api/status', 'en'), 'https://example.test/en');
  assert.equal(localizedUrl('https://example.test/en/settings', 'en', 'overview').href, 'https://example.test/en');
});
