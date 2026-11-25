import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authConfigManager, SessionProvider, useSession, signIn, signOut } from '@hono/auth-js/react';
import { chooseLanguage, localizedCallback, localizedUrl, translate, type Language } from './i18n';
import { Alert, Button, LocalePicker } from '@oddmash/ui';
import { Dashboard } from './dashboard';
import '@oddmash/ui/styles.css';
import './globals.css';

authConfigManager.setConfig({ basePath: '/api/auth' });

const Console = () => {
  const [language, setLanguage] = useState<Language>(() => { try { return chooseLanguage(new URLSearchParams(window.location.search).get('lang') ?? localStorage.getItem('oddmash-console-language') ?? navigator.language); } catch { return chooseLanguage(navigator.language); } });
  const t = (message: Parameters<typeof translate>[1]) => translate(language, message);
  useEffect(() => { document.documentElement.lang = language; document.title = 'Oddmash | ' + t('Agents Console'); const url = localizedUrl(window.location.href, language); if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url); try { localStorage.setItem('oddmash-console-language', language); } catch {} }, [language]);
  const languageControl = <div className="language-control"><span>{t('Language')}</span><LocalePicker label={t('Language')} value={language} options={[{ value: 'en', label: 'English', lang: 'en', href: localizedUrl(window.location.href, 'en').href }, { value: 'ko', label: '한국어', lang: 'ko', href: localizedUrl(window.location.href, 'ko').href }]} onValueChange={value => setLanguage(chooseLanguage(value))}/></div>;
  const { status, data } = useSession();
  const [signInError, setSignInError] = useState(false);
  const [configured, setConfigured] = useState<'checking' | 'ready' | 'unconfigured' | 'error'>('checking');
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/availability', { cache: 'no-store', signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error('Availability unavailable'); return response.json(); })
      .then(value => setConfigured(value.configured === true ? 'ready' : value.configured === false ? 'unconfigured' : 'error'))
      .catch(() => { if (!abort.signal.aborted) setConfigured('error'); });
    return () => abort.abort();
  }, []);
  if (configured === 'checking' || status === 'loading') return <main className="login">{languageControl}<h1>Oddmash Agents</h1><p role="status">{t("Checking session…")}</p></main>;
  if (configured === 'unconfigured') return <main className="login">{languageControl}<h1>Oddmash Agents</h1><p>{t("Console authentication is not configured.")}</p></main>;
  if (status !== 'authenticated' || !data?.user?.id) return <main className="login">{languageControl}<p className="eyebrow">ODDMASH / OPERATIONS</p><h1>{t("Agents Console")}</h1><p>{t("Sign in with the authorized GitHub account to view agent activity.")}</p>{configured === 'error' && <p role="status">{t("Unable to verify configuration. You can retry sign-in or reload this page.")}</p>}{signInError && <Alert role="alert" tone="danger">{t("Unable to start GitHub sign-in. Please try again.")}</Alert>}<Button variant="secondary" className="login-button" onClick={() => { setSignInError(false); void signIn('github', { callbackUrl: localizedCallback(window.location.origin, window.location.hash, language) }).catch(() => setSignInError(true)); }}>{t("Sign in with GitHub")}</Button></main>;
  return <Dashboard language={language} languageControl={languageControl} logout={<Button variant="secondary" className="login-button" onClick={() => void signOut({ callbackUrl: localizedCallback(window.location.origin, window.location.hash, language) })}>{t("Sign out")}</Button>} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><Console /></SessionProvider></StrictMode>);
