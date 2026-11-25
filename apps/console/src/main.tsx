import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authConfigManager, SessionProvider, useSession, signIn, signOut } from '@hono/auth-js/react';
import { chooseLanguage, consoleRoute, localizedCallback, localizedUrl, translate, type Language, type ConsoleView } from './i18n';
import { Alert, Button, LocalePicker } from '@oddmash/ui';
import { AgentLoading } from './agent-loading';
import { Dashboard } from './dashboard';
import '@oddmash/ui/styles.css';
import './globals.css';

authConfigManager.setConfig({ basePath: '/api/auth' });

const Console = () => {
  const [route, setRoute] = useState(() => {
    const initial = consoleRoute(window.location.href);
    let preferred: Language;
    try { preferred = chooseLanguage(localStorage.getItem('oddmash-console-language') ?? navigator.language); } catch { preferred = chooseLanguage(navigator.language); }
    return { language: initial.language ?? preferred, view: initial.view };
  });
  const { language, view } = route;
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
  useEffect(() => { document.documentElement.lang = language; document.title = 'Oddmash | ' + t('Agents Console'); const url = localizedUrl(window.location.href, language, view); if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url); try { localStorage.setItem('oddmash-console-language', language); } catch {} }, [language, view]);
  const languageControl = <div className="language-control"><span>{t('Language')}</span><LocalePicker label={t('Language')} value={language} options={[{ value: 'en', label: 'English', lang: 'en', href: localizedUrl(window.location.href, 'en', view).href }, { value: 'ko', label: '한국어', lang: 'ko', href: localizedUrl(window.location.href, 'ko', view).href }]} onValueChange={value => navigate(chooseLanguage(value), view)}/></div>;
  const { status, data } = useSession();
  const [signInError, setSignInError] = useState(false);
  const [configured, setConfigured] = useState<'checking' | 'ready' | 'unconfigured' | 'error'>('checking');
  useEffect(() => {
    const abort = new AbortController();
    const timeout = setTimeout(() => { setConfigured('error'); abort.abort(); }, 12000);
    fetch('/api/availability', { cache: 'no-store', signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error('Availability unavailable'); return response.json(); })
      .then(value => setConfigured(value.configured === true ? 'ready' : value.configured === false ? 'unconfigured' : 'error'))
      .finally(() => clearTimeout(timeout))
      .catch(() => { if (!abort.signal.aborted) setConfigured('error'); });
    return () => { clearTimeout(timeout); abort.abort(); };
  }, []);
  if (status === 'loading' || (status !== 'authenticated' && configured === 'checking')) return <main className="session-loading"><AgentLoading label={t("Checking session…")}/></main>;
  if (status !== 'authenticated' && configured === 'unconfigured') return <main className="login">{languageControl}<h1>Oddmash Agents</h1><p>{t("Console authentication is not configured.")}</p></main>;
  if (status !== 'authenticated' || !data?.user?.id) return <main className="login">{languageControl}<p className="eyebrow">ODDMASH / OPERATIONS</p><h1>{t("Agents Console")}</h1><p>{t("Sign in with the authorized GitHub account to view agent activity.")}</p>{configured === 'error' && <p role="status">{t("Unable to verify configuration. You can retry sign-in or reload this page.")}</p>}{signInError && <Alert role="alert" tone="danger">{t("Unable to start GitHub sign-in. Please try again.")}</Alert>}<Button variant="secondary" className="login-button" onClick={() => { setSignInError(false); void signIn('github', { callbackUrl: localizedCallback(window.location.origin, localizedUrl(window.location.href, language, view).pathname, language) }).catch(() => setSignInError(true)); }}>{t("Sign in with GitHub")}</Button></main>;
  return <Dashboard view={view} navigate={nextView => navigate(language, nextView)} language={language} languageControl={languageControl} logout={<Button variant="secondary" className="login-button" onClick={() => void signOut({ callbackUrl: localizedCallback(window.location.origin, localizedUrl(window.location.href, language, view).pathname, language) })}>{t("Sign out")}</Button>} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><Console /></SessionProvider></StrictMode>);
