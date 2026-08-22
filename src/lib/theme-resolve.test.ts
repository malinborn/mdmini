import { describe, it, expect } from 'vitest';
import { resolveTheme, familyOf, isDarkTheme } from './theme-resolve';

describe('resolveTheme', () => {
  it('ExplicitPreference_ReturnsItself', () => {
    expect(resolveTheme('light', 'classic', true)).toBe('light');
    expect(resolveTheme('dark', 'aurora', false)).toBe('dark');
    expect(resolveTheme('aurora-light', 'classic', true)).toBe('aurora-light');
    expect(resolveTheme('aurora-dark', 'classic', false)).toBe('aurora-dark');
  });

  it('System_ClassicFamily_FollowsOs', () => {
    expect(resolveTheme('system', 'classic', false)).toBe('light');
    expect(resolveTheme('system', 'classic', true)).toBe('dark');
  });

  it('System_AuroraFamily_FollowsOs', () => {
    expect(resolveTheme('system', 'aurora', false)).toBe('aurora-light');
    expect(resolveTheme('system', 'aurora', true)).toBe('aurora-dark');
  });
});

describe('familyOf', () => {
  it('MapsConcreteThemesToFamilies', () => {
    expect(familyOf('light')).toBe('classic');
    expect(familyOf('dark')).toBe('classic');
    expect(familyOf('aurora-light')).toBe('aurora');
    expect(familyOf('aurora-dark')).toBe('aurora');
  });
});

describe('isDarkTheme', () => {
  it('DetectsDarkVariants', () => {
    expect(isDarkTheme('dark')).toBe(true);
    expect(isDarkTheme('aurora-dark')).toBe(true);
    expect(isDarkTheme('light')).toBe(false);
    expect(isDarkTheme('aurora-light')).toBe(false);
  });
});
