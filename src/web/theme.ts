import type { ThemeName } from '@open-tomato/components';

import { useState } from 'react';

/** The `localStorage` key that holds the theme the person chose with the topbar switch. */
export const THEME_STORAGE_KEY = 'theme';

/** The theme the app opens in until the person picks one with the topbar switch, whatever the OS is set to. */
export const DEFAULT_THEME: ThemeName = 'light';

/**
 * The theme to show: a stored choice when it names a theme, and {@link DEFAULT_THEME} otherwise.
 * The OS setting is not read, so a computer set to dark still opens the app light.
 *
 * @param stored - The value under {@link THEME_STORAGE_KEY}, or `null` when nothing is stored.
 * @returns The theme.
 */
export function themeFrom(stored: string | null): ThemeName {
  return stored === 'light' || stored === 'dark'
    ? stored
    : DEFAULT_THEME;
}

/** The stored choice, or `null` when there is none or the browser refuses storage. */
function storedTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The theme the app starts in: the stored choice, else {@link DEFAULT_THEME}, which is also the
 * theme where there is no browser, as in a render test.
 *
 * @returns The theme.
 */
export function startingTheme(): ThemeName {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  return themeFrom(storedTheme());
}

/**
 * Shows `theme` by setting `data-theme` on the page root, which the component library's tokens
 * read, and stores it as the person's choice. A browser that refuses storage still shows it.
 *
 * @param theme - The theme to show.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme is shown for this visit only; nothing else depends on the stored copy.
  }
}

/**
 * Sets `data-theme` before the first render, so the sign-in page and the first paint follow it:
 * the stored choice, or {@link DEFAULT_THEME} with nothing stored. It always sets one, because
 * with no `data-theme` the library's tokens follow the OS setting. It stores nothing, so the
 * default is never mistaken for a choice.
 */
export function applyStoredTheme(): void {
  document.documentElement.dataset.theme = themeFrom(storedTheme());
}

/**
 * The theme on show and a setter that shows and stores a new one, for the topbar switch.
 *
 * @returns The theme and the setter.
 */
export function useTheme(): readonly [ThemeName, (next: ThemeName) => void] {
  const [theme, setTheme] = useState<ThemeName>(startingTheme);
  const choose = (next: ThemeName): void => {
    applyTheme(next);
    setTheme(next);
  };
  return [theme, choose];
}
