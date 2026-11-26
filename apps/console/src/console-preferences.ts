export const themes = ['light', 'dark', 'system'] as const;
export type ThemePreference = typeof themes[number];
export type ResolvedTheme = 'light' | 'dark';

export const parseTheme = (value: unknown): ThemePreference =>
  themes.includes(value as ThemePreference) ? value as ThemePreference : 'system';

export const resolveTheme = (preference: ThemePreference, darkSystem: boolean): ResolvedTheme =>
  preference === 'system' ? darkSystem ? 'dark' : 'light' : preference;
