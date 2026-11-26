import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../src/dashboard';
import { useUnsavedGuard } from '../src/unsaved-guard';
import { useConsoleHistory } from '../src/use-console-history';
import { ThemeControl, SignOutButton } from '../src/preference-controls';
import type { ThemePreference } from '../src/console-preferences';
import { Button } from '@oddmash/ui';
import { localizedUrl, type ConsoleView, type Language } from '../src/i18n';
import '@oddmash/ui/styles.css';
import '../src/globals.css';

const params = new URLSearchParams(location.search);
const language = params.get('language') === 'ko' ? 'ko' : 'en';
document.documentElement.lang = language;
document.documentElement.dataset.omTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const Fixture = () => {
  const [route, setRoute] = useState<{language: Language; view: ConsoleView}>({language,view:params.get('view') === 'contributors' ? 'contributors' : params.get('view') === 'usage' ? 'usage' : 'overview'});
  const {view} = route;
  const [theme, setTheme] = useState<ThemePreference>(params.get('theme') === 'dark' ? 'dark' : 'light');
  useEffect(()=>{document.documentElement.dataset.omTheme=theme==='dark'?'dark':'light';},[theme]);
  const { unsaved, setUnsaved, guard, dialog } = useUnsavedGuard(language);
  const navigate = useConsoleHistory(route, setRoute, unsaved, guard);
  useEffect(()=>{window.history.replaceState(window.history.state,'',localizedUrl(window.location.href,language,view));},[view]);
  return <><Dashboard onUnsavedChange={setUnsaved} view={view} navigate={next => navigate(language,next)} language={language} themeControl={<ThemeControl language={language} theme={theme} onChange={setTheme}/>} languageControl={<Button>Language</Button>} logout={<SignOutButton language={language} onClick={()=>navigate(language,'overview')}/>}/>{dialog}</>;
};
createRoot(document.getElementById('root')!).render(<Fixture/>);
