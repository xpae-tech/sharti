// Interface theme: persisted in preferences and cached in localStorage so the
// cached value can be applied before the first paint (see index.html).

import { S } from './state.js';
import type { Theme } from '../types.js';

const STORAGE_KEY = 'sharti-theme';

export function normalizeTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark';
}

/** Apply a theme to the document and keep the localStorage cache in sync. */
export function applyTheme(theme: Theme, cache = true): void {
  const next = normalizeTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = next;
  // Keep the browser chrome colour in sync with the same variable the app uses.
  const meta = document.getElementById('themeColor');
  if (meta) {
    const chromeColor = getComputedStyle(root).getPropertyValue('--bg-window').trim();
    if (chromeColor) meta.setAttribute('content', chromeColor);
  }
  if (cache) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage may be unavailable */ }
  }
}

/** Apply the theme currently stored in the application preferences. */
export function syncThemeFromPrefs(): void {
  applyTheme(normalizeTheme(S.prefs.theme));
}

/** Select a theme: updates state, the document and the cache immediately. */
export function setTheme(theme: Theme): void {
  S.prefs.theme = normalizeTheme(theme);
  applyTheme(S.prefs.theme);
}
