// Light / dark theme (M7-11, ADR-023 D-42). Light is the default; the choice
// is kept on this device in localStorage (listed on the Privacy page, reset by
// Clear all local data). public/theme-boot.js applies it before the first
// paint (a classic script in <head>: a module script runs after the browser
// may already have painted, which would flash light); this module owns it
// from then on. Windows High Contrast (`forced-colors`) overrides both
// themes in tokens.css. PDF pages stay white in both (tokens.css --color-page).
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

/** localStorage key (storage names keep "pdftools", D-41). public/theme-boot.js uses the same. */
export const THEME_STORAGE_KEY = 'pdftools.theme';

/**
 * The browser / installed-app title bar (`<meta name="theme-color">`): the
 * accent in light, as before; the app background in dark (tokens.css
 * --color-bg), so the window frame does not glare above a dark app.
 */
export const THEME_COLOR: Readonly<Record<Theme, string>> = {
  light: '#0f6cbd',
  dark: '#1f1f1f',
};

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

/** The stored choice; light when none (or storage is blocked). */
export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : 'light';
  } catch {
    return 'light';
  }
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

let current: Theme = typeof document === 'undefined' ? 'light' : readStoredTheme();
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return current;
}

/** Switches the theme now and remembers it on this device (light removes the entry). */
export function setTheme(theme: Theme): void {
  try {
    if (theme === 'light') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode policies): the theme still changes for this session.
  }
  if (theme === current) {
    applyToDocument(theme);
    return;
  }
  current = theme;
  applyToDocument(theme);
  for (const l of listeners) l();
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

/** Clear all local data: forget the choice and go back to the default. */
export function resetTheme(): void {
  setTheme('light');
}

/** Applies the stored choice (the boot script already did; this keeps the two in step). */
export function initTheme(): void {
  current = readStoredTheme();
  applyToDocument(current);
}

export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, () => 'light');
}
