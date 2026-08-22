export type ThemeSetting = 'light' | 'dark' | 'aurora-light' | 'aurora-dark' | 'system';
export type ConcreteTheme = Exclude<ThemeSetting, 'system'>;
export type ThemeFamily = 'classic' | 'aurora';

export function familyOf(theme: ConcreteTheme): ThemeFamily {
  return theme.startsWith('aurora') ? 'aurora' : 'classic';
}

export function isDarkTheme(theme: ConcreteTheme): boolean {
  return theme.endsWith('dark');
}

/** System follows the OS appearance within the last explicitly chosen family. */
export function resolveTheme(
  preference: ThemeSetting,
  lastFamily: ThemeFamily,
  systemDark: boolean
): ConcreteTheme {
  if (preference !== 'system') return preference;
  if (lastFamily === 'aurora') return systemDark ? 'aurora-dark' : 'aurora-light';
  return systemDark ? 'dark' : 'light';
}
