import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../src/dashboard';
import { useUnsavedGuard } from '../src/unsaved-guard';
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
  const { setUnsaved, guard, dialog } = useUnsavedGuard(language);
  return <><Dashboard onUnsavedChange={setUnsaved} view={view} navigate={next => { if(next!==view) guard(()=>navigate(next)); }} language={language} themeControl={<Button>Theme</Button>} languageControl={<Button>Language</Button>} logout={<Button>Sign out</Button>}/>{dialog}</>;
};
createRoot(document.getElementById('root')!).render(<Fixture/>);
