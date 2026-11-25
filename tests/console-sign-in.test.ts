import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (name: string) => readFileSync(new URL('../apps/console/' + name, import.meta.url), 'utf8');

test('unauthenticated presentation is English without affecting the authenticated locale', () => {
  const main = source('src/main.tsx');
  const screen = source('src/sign-in-screen.tsx');
  assert.match(main, /authenticated \? language : 'en'/);
  assert.match(main, /<AgentLoading label="Checking session…"/);
  assert.match(main, /if \(!authenticated\) return <SignInScreen/);
  assert.match(main, /localizedCallback\(window\.location\.origin, localizedUrl\(window\.location\.href, language, view\)\.pathname, language\)/);
  assert.match(screen, /<main className="login" lang="en">/);
  assert.match(screen, /Sign in with GitHub/);
  assert.doesNotMatch(screen, /LocalePicker|languageControl|translate\(/);
});

test('sign-in uses one pending action and leaves account authorization server-side', () => {
  const screen = source('src/sign-in-screen.tsx');
  const auth = source('auth.ts');
  assert.match(screen, /inFlight\.current \|\| availability === 'unconfigured'/);
  assert.match(screen, /disabled=\{pending\}/);
  assert.match(screen, /role="status" aria-live="polite"/);
  assert.match(auth, /scope: 'read:user', prompt: 'select_account'/);
  assert.match(auth, /signIn\(\{ account, profile \}\) \{ return account\?\.provider === 'github' && owner\(profile\?\.id\); \}/);
});

test('login glow remains static and token-backed', () => {
  const css = source('src/globals.css');
  const glow = css.match(/\.login::before \{[^}]+\}/)?.[0] ?? '';
  assert.match(glow, /radial-gradient/);
  assert.match(glow, /opacity: var\(--console-login-glow-opacity\)/);
  assert.doesNotMatch(glow, /animation|transition/);
  assert.match(css, /\.login-action \{[^}]+min-height: var\(--console-length-44\)/);
});
