/**
 * Theme preference at the localStorage boundary, plus the effect that publishes
 * the active theme onto the document element.
 *
 * The theme is an explicit choice between light and dark; the operating system
 * preference is not consulted. The preference is disposable, so an unreadable
 * or unknown stored value falls back to light.
 */
import { useEffect, useLayoutEffect, useState } from 'react';

import { bestEffortLocalStorage } from '../../bestEffortStorage';

/** The themes a viewer can choose between. */
export type Theme = 'dark' | 'light';

/** Disposable preference key for the selected theme. */
export const LOCAL_THEME_KEY = 'chalkboard:theme';

/** Reads the stored theme, defaulting to light. */
export function loadTheme(): Theme {
  return bestEffortLocalStorage.getItem(LOCAL_THEME_KEY) === 'dark'
    ? 'dark'
    : 'light';
}

/** Owns the theme preference and mirrors it to the document element. */
export function useTheme(): {
  setTheme(theme: Theme): void;
  theme: Theme;
} {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  // Written in a layout effect so the attribute is in place before paint, and
  // before the canvas effects that resolve their colors from computed style.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    bestEffortLocalStorage.setItem(LOCAL_THEME_KEY, theme);
  }, [theme]);

  return { setTheme, theme };
}
