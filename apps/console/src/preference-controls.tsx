import { Button } from '@oddmash/ui';
import { translate, type Language } from './i18n';
import type { ThemePreference } from './console-preferences';

export const ThemeControl = ({ language, theme, onChange }: { language: Language; theme: ThemePreference; onChange: (value: ThemePreference) => void }) => {
  const t = (message: Parameters<typeof translate>[1]) => translate(language, message);
  return <div className="language-control"><span>{t('Theme')}</span><div role="group" aria-label={t('Theme')} className="theme-options">{(['system','light','dark'] as const).map(value => <Button key={value} variant={theme===value?'primary':'secondary'} aria-pressed={theme===value} aria-label={t(value==='system'?'System':value==='light'?'Light':'Dark')} title={t(value==='system'?'System':value==='light'?'Light':'Dark')} onClick={()=>onChange(value)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{value==='system'?<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>:value==='light'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M19 5l-1 1M6 18l-1 1"/></>:<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>}</svg></Button>)}</div></div>;
};

export const SignOutButton = ({ language, onClick }: { language: Language; onClick: () => void }) =>
  <Button variant="secondary" className="login-button console-logout" onClick={onClick}>{translate(language,'Sign out')}</Button>;
