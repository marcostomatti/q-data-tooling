import { describe, expect, test } from 'bun:test';

import { DEFAULT_THEME, startingTheme, themeFrom } from '../../src/web/theme.ts';

describe('themeFrom', () => {
  test('a stored choice names the theme', () => {
    expect(themeFrom('dark')).toBe('dark');
    expect(themeFrom('light')).toBe('light');
  });

  test('with no stored choice the app is light, whatever the OS is set to', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(themeFrom(null)).toBe(DEFAULT_THEME);
  });

  test('a stored value that names no theme is ignored', () => {
    expect(themeFrom('purple')).toBe(DEFAULT_THEME);
  });
});

describe('startingTheme', () => {
  test('is light where there is no browser, as in a render test', () => {
    expect(startingTheme()).toBe('light');
  });
});
