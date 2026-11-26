import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '../src/dashboard';
import { Button } from '@oddmash/ui';
import { type ConsoleView } from '../src/i18n';
import '@oddmash/ui/styles.css';
import '../src/globals.css';

const params = new URLSearchParams(location.search);
const language = params.get('language') === 'ko' ? 'ko' : 'en';
document.documentElement.lang = language;
document.documentElement.dataset.omTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
const Fixture = () => {
  const [view, navigate] = useState<ConsoleView>(params.get('view') === 'contributors' ? 'contributors' : 'overview');
  return <Dashboard view={view} navigate={navigate} language={language} themeControl={<Button>Theme</Button>} languageControl={<Button>Language</Button>} logout={<Button>Sign out</Button>}/>;
};
createRoot(document.getElementById('root')!).render(<Fixture/>);
