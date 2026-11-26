import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('console styles are generated deterministically from JSON design tokens', () => {
  const script = fileURLToPath(new URL('../scripts/generate-console-tokens.mjs', import.meta.url));
  execFileSync(process.execPath, [script, '--check']);
  const css = readFileSync(new URL('../apps/console/src/globals.css', import.meta.url), 'utf8');
  const tokens = JSON.parse(readFileSync(new URL('../apps/console/src/console-tokens.json', import.meta.url), 'utf8'));
  assert.ok(css.includes('--console-duration-800: 800ms;'));
  assert.ok(css.includes('--console-activity-spinner-size: .75em;'));
  assert.match(css, /\.activity-spinner\s*\{[^}]+var\(--console-duration-800\)/);
  assert.match(css, /\.repository-list/);
  assert.ok(css.includes('var(--om-semantic-space-md)'));
  assert.ok(css.includes('var(--om-semantic-border-width)'));
  assert.ok(css.includes('var(--om-semantic-radius-lg)'));
  for (const value of Object.values(tokens.breakpoints)) assert.ok(css.includes('@media (max-width: ' + value + ')'));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /\{\{[^}]+\}\}/);
});

test('sidebar inset rules apply only to unpositioned Select fallback menus', () => {
  const css = readFileSync(new URL('../apps/console/src/globals.css', import.meta.url), 'utf8');
  const selectors = [...css.matchAll(/\.logout \.om-select-dropdown > \[role=listbox\][^{]*\{/g)];
  assert.equal(selectors.length, 2);
  assert.ok(selectors.every(match => match[0].includes(':not([data-positioned="true"])')));
});

test('compact dashboard keeps readable type and primary control targets', () => {
  const css = readFileSync(new URL('../apps/console/src/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.shell \{[^}]+font-size: var\(--console-length-14\)/);
  assert.match(css, /\.fleet-row small \{[^}]+font-size: var\(--console-length-12\)/);
  assert.match(css, /\.overview-metrics \.metric-link \{[^}]+min-height: var\(--console-length-44\)/);
  assert.match(css, /\.repository-toggle \{[^}]+width: var\(--console-length-44\); height: var\(--console-length-44\)/);
  assert.match(css, /\.console-nav a \{[^}]+min-block-size: var\(--console-length-44\)/);
  assert.match(css, /\.activity-filters \.om-select, \.language-control \.om-select \{ min-height: var\(--console-length-44\)/);
});
