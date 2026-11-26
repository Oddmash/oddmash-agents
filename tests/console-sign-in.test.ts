import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { signInErrorMessage, clearSignInError } from '../apps/console/src/sign-in-feedback.ts';
import { consoleApi } from '../apps/console/auth.ts';

const source = (name: string) => readFileSync(new URL('../apps/console/' + name, import.meta.url), 'utf8');

test('unauthenticated presentation is English without affecting the authenticated locale', () => {
  const main = source('src/main.tsx');
  const screen = source('src/sign-in-screen.tsx');
  assert.match(main, /authenticated \? language : 'en'/);
  assert.match(main, /<AgentLoading label="Checking session…"/);
  assert.match(main, /if \(!authenticated\) return <SignInScreen/);
  assert.match(main, /localizedCallback\(window\.location\.origin, localizedUrl\(window\.location\.href, language, view\)\.pathname, language\)/);
  assert.match(main, /<Dashboard[^\n]+languageControl=\{languageControl\} themeControl=\{themeControl\}/);
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
  assert.match(screen, /disabled=\{pending\} aria-busy=\{pending\}/);
  assert.match(screen, /<svg className="login-github-icon"[^>]*aria-hidden="true"/);
  assert.match(screen, /<span>\{pending \? 'Redirecting\.\.\.' : 'Sign in with GitHub'\}<\/span>/);
  assert.match(screen, /login-progress[^>]*>\{pending \? 'Redirecting to GitHub\.'/);
  assert.doesNotMatch(screen, /Opening GitHub sign-in/);
  assert.match(screen, /finally \{ inFlight\.current = false; setPending\(false\); \}/);
  assert.match(auth, /scope: 'read:user', prompt: 'select_account'/);
  assert.match(auth, /signIn\(\{ account, profile \}\) \{ return account\?\.provider === 'github' && owner\(profile\?\.id\); \}/);
});

test('OAuth errors return to the public console with safe visible feedback', async () => {
  const environment = { AUTH_URL: 'https://console.example.test/api/auth', AUTH_SECRET: 'fixture-only-secret', AUTH_GITHUB_ID: 'fixture-id', AUTH_GITHUB_SECRET: 'fixture-secret', CONSOLE_OWNER_GITHUB_ID: '123' };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    const response = await consoleApi.fetch(new Request('https://console.example.test/api/auth/error?error=AccessDenied'));
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location')!, 'https://console.example.test');
    assert.equal(location.origin, 'https://console.example.test');
    assert.equal(location.pathname, '/');
    assert.match(signInErrorMessage(location.href)!, /Access denied.*not authorized/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(signInErrorMessage('https://console.example.test/ko'), undefined);
  assert.equal(signInErrorMessage('https://console.example.test/ko?error=OAuthCallbackError'), 'GitHub sign-in could not be completed. Please try again.');
  assert.equal(signInErrorMessage('https://console.example.test/ko?error=untrusted-provider-text'), 'GitHub sign-in could not be completed. Please try again.');
  assert.equal(clearSignInError('https://console.example.test/ko/activity?error=AccessDenied&keep=1').href, 'https://console.example.test/ko/activity?keep=1');
});

test('login glow remains static and token-backed', () => {
  const css = source('src/globals.css');
  const glow = css.match(/\.login::before \{[^}]+\}/)?.[0] ?? '';
  assert.match(glow, /radial-gradient/);
  assert.match(glow, /opacity: var\(--console-login-glow-opacity\)/);
  assert.doesNotMatch(glow, /animation|transition/);
  assert.match(css, /\.login-action \{[^}]+min-height: var\(--console-length-44\)/);
  assert.match(css, /\.login-progress \{[^}]+position: absolute;[^}]+clip-path: inset\(50%\)/);
  assert.match(css, /\.login-github-icon \{[^}]+width: var\(--console-length-18\)/);
});

test('login copy uses Juliya for responsive wrapping', () => {
  const screen = source('src/sign-in-screen.tsx');
  assert.match(screen, /import \{ JuliyaText \} from '@oddmash\/juliya\/react'/);
  assert.match(screen, /<JuliyaText as="p" locale="en">Monitor agent activity/);
  assert.match(screen, /<Alert[^>]*><JuliyaText as="span" locale="en">/);
  assert.match(screen, /<JuliyaText as="p" locale="en" className="login-restriction">/);
  assert.equal(signInErrorMessage('https://console.example.test/?error=AccessDenied'), 'Access denied. This GitHub account is not authorized. Try another account.');
});
