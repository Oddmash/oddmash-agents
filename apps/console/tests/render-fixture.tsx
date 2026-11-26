import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../src/dashboard';
import { useUnsavedGuard } from '../src/unsaved-guard';
import { ThemeControl, SignOutButton } from '../src/preference-controls';
import type { ThemePreference } from '../src/console-preferences';
import { Button } from '@oddmash/ui';
import { type ConsoleView } from '../src/i18n';
import '@oddmash/ui/styles.css';
import '../src/globals.css';

const params = new URLSearchParams(location.search);
const language = params.get('language') === 'ko' ? 'ko' : 'en';
document.documentElement.lang = language;
document.documentElement.dataset.omTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const Fixture = () => {
  const [view, navigate] = useState<ConsoleView>(params.get('view') === 'contributors' ? 'contributors' : params.get('view') === 'usage' ? 'usage' : 'overview');
  const [theme, setTheme] = useState<ThemePreference>(params.get('theme') === 'dark' ? 'dark' : 'light');
  useEffect(()=>{document.documentElement.dataset.omTheme=theme==='dark'?'dark':'light';},[theme]);
  const { setUnsaved, guard, dialog } = useUnsavedGuard(language);
  return <><Dashboard onUnsavedChange={setUnsaved} view={view} navigate={next => { if(next!==view) guard(()=>navigate(next)); }} language={language} themeControl={<ThemeControl language={language} theme={theme} onChange={setTheme}/>} languageControl={<Button>Language</Button>} logout={<SignOutButton language={language} onClick={()=>guard(()=>navigate('overview'))}/>}/>{dialog}</>;
};
createRoot(document.getElementById('root')!).render(<Fixture/>);
