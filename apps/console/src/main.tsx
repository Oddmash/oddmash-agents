import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authConfigManager, SessionProvider, useSession, signIn, signOut } from '@hono/auth-js/react';
import { chooseLanguage, consoleRoute, localizedCallback, localizedUrl, translate, type Language, type ConsoleView } from './i18n';
import { Button, LocalePicker, Select } from '@oddmash/ui';
import { AgentLoading } from './agent-loading';
import { parseTheme, resolveTheme, type ThemePreference } from './console-preferences';
import { Dashboard } from './dashboard';
import { SignInScreen } from './sign-in-screen';
import { clearSignInError, signInErrorMessage } from './sign-in-feedback';
import { useFirstPartySession } from './use-first-party-session';
import '@oddmash/ui/styles.css';
import './globals.css';

authConfigManager.setConfig({ basePath: '/api/auth' });

const themeKey = 'oddmash-console-theme';
const readTheme = () => { try { return parseTheme(localStorage.getItem(themeKey)); } catch { return 'system' as const; } };
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = (preference: ThemePreference) => { document.documentElement.dataset.omTheme = resolveTheme(preference, systemDark.matches); };
applyTheme(readTheme());

const Console = () => {
  const [route, setRoute] = useState(() => {
    const initial = consoleRoute(window.location.href);
    let preferred: Language;
    try { preferred = chooseLanguage(localStorage.getItem('oddmash-console-language') ?? navigator.language); } catch { preferred = chooseLanguage(navigator.language); }
    return { language: initial.language ?? preferred, view: initial.view };
  });
  const { language, view } = route;
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  useEffect(() => {
    const update = () => applyTheme(theme);
    update();
    systemDark.addEventListener('change', update);
    try { localStorage.setItem(themeKey, theme); } catch {}
    return () => systemDark.removeEventListener('change', update);
  }, [theme]);
  const t = (message: Parameters<typeof translate>[1]) => translate(language, message);
  const navigate = (nextLanguage: Language, nextView: ConsoleView) => {
    const url = localizedUrl(window.location.href, nextLanguage, nextView);
    if (url.href !== window.location.href) window.history.pushState(window.history.state, '', url);
    setRoute({ language: nextLanguage, view: nextView });
  };
  useEffect(() => {
    const sync = () => {
      const next = consoleRoute(window.location.href);
      setRoute(current => ({ language: next.language ?? current.language, view: next.view }));
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  useEffect(() => { const url = localizedUrl(window.location.href, language, view); if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url); try { localStorage.setItem('oddmash-console-language', language); } catch {} }, [language, view]);
  const languageControl = <div className="language-control"><span>{t('Language')}</span><LocalePicker label={t('Language')} value={language} options={[{ value: 'en', label: 'English', lang: 'en', href: localizedUrl(window.location.href, 'en', view).href }, { value: 'ko', label: '한국어', lang: 'ko', href: localizedUrl(window.location.href, 'ko', view).href }]} onValueChange={value => navigate(chooseLanguage(value), view)}/></div>;
  const themeControl = <div className="language-control"><span>{t('Theme')}</span><Select aria-label={t('Theme')} value={theme} options={[{ value: 'light', label: t('Light') }, { value: 'dark', label: t('Dark') }, { value: 'system', label: t('System') }]} onValueChange={value => { const preference = parseTheme(value); applyTheme(preference); setTheme(preference); }}/></div>;
  const { status, data } = useSession();
  const [configured, setConfigured] = useState<'checking' | 'ready' | 'unconfigured' | 'error'>('checking');
  const [mode, setMode] = useState<'legacy' | 'first-party'>('legacy');
  const legacyAuthenticated = status === 'authenticated' && Boolean(data?.user?.id);
  const firstParty = useFirstPartySession(configured === 'ready' && mode === 'first-party', status !== 'loading', legacyAuthenticated);
  const authenticated = configured === 'ready' && (mode === 'first-party' ? firstParty.state === 'authenticated' : legacyAuthenticated);
  const logout = async () => {
    if (mode === 'first-party' && !await firstParty.logout()) return;
    await signOut({ callbackUrl: localizedCallback(window.location.origin, localizedUrl(window.location.href, language, view).pathname, language) });
  };
  const [loginError, setLoginError] = useState(() => signInErrorMessage(window.location.href));
  useEffect(() => {
    const visibleLanguage = authenticated ? language : 'en';
    document.documentElement.lang = visibleLanguage;
    document.title = 'Oddmash | ' + translate(visibleLanguage, 'Agents Console');
  }, [authenticated, language]);
  useEffect(() => {
    if (!authenticated) return;
    setLoginError(undefined);
    const url = clearSignInError(window.location.href);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [authenticated]);
  useEffect(() => {
    const abort = new AbortController();
    const timeout = setTimeout(() => { setConfigured('error'); abort.abort(); }, 12000);
    fetch('/api/availability', { cache: 'no-store', signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error('Availability unavailable'); return response.json(); })
      .then(value => { setMode(value.sessionMode === 'first-party' ? 'first-party' : 'legacy'); setConfigured(value.configured === true ? 'ready' : value.configured === false ? 'unconfigured' : 'error'); })
      .finally(() => clearTimeout(timeout))
      .catch(() => { if (!abort.signal.aborted) setConfigured('error'); });
    return () => { clearTimeout(timeout); abort.abort(); };
  }, []);
  if (mode === 'first-party' && firstParty.state === 'logout-pending') return <main className="session-loading" lang="en"><p role="alert">Sign-out could not be confirmed. Retry to revoke this session.</p><Button onClick={() => void logout()}>Retry sign out</Button></main>;
  if (status === 'loading' || configured === 'checking' || (configured === 'ready' && mode === 'first-party' && firstParty.state === 'checking')) return <main className="session-loading" lang="en"><AgentLoading label="Checking session…"/></main>;
  if (!authenticated) return <SignInScreen availability={mode === 'first-party' && firstParty.state === 'unavailable' ? 'error' : configured} errorMessage={loginError} onSignIn={async () => { setLoginError(undefined); const url = clearSignInError(window.location.href); if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url); await signIn('github', { callbackUrl: localizedCallback(window.location.origin, localizedUrl(window.location.href, language, view).pathname, language) }); }} />;
  return <Dashboard view={view} navigate={nextView => navigate(language, nextView)} language={language} languageControl={languageControl} themeControl={themeControl} logout={<Button variant="secondary" className="login-button" onClick={() => void logout()}>{t("Sign out")}</Button>} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><Console /></SessionProvider></StrictMode>);
