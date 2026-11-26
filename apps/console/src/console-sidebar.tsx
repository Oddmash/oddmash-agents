import type { ConsoleView } from './i18n';

export const NavigationIcon = ({ view }: { view: ConsoleView }) => {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    activity: <><path d="M3 12h4l3-7 4 14 3-7h4"/><path d="M3 20h18" opacity=".4"/></>,
    contributors: <><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10M18 7v3a6 6 0 0 1-6 6h-2"/></>,
    usage: <><path d="M3 3v18h18"/><path d="M7 17v-4M12 17V8M17 17V5"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--background)"/><circle cx="15" cy="17" r="2" fill="var(--background)"/></>
  };
  return <svg className="console-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[view]}</svg>;
};
