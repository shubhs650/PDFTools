// Light / dark theme (M7-11, ADR-023 D-42). Light is the default; the choice
// is kept on this device in localStorage (listed on the Privacy page, reset by
// Clear all local data). public/theme-boot.js applies it before the first
// paint (a classic script in <head>: a module script runs after the browser
// may already have painted, which would flash light); this module owns it
// from then on. Windows High Contrast (`forced-colors`) overrides both
// themes in tokens.css. PDF pages stay white in both (tokens.css --color-page).
//
// The accent colour (ADR-027 D-47, M10 O7) works the same way: Blue is the
// default, Teal, Indigo and Graphite set `data-accent` on <html>, and
// tokens.css swaps only the brand, accent, link, focus and selection tokens.
// Comment colours, highlight and sticky-note yellow and the white page never
// follow it.
//
// The density (ADR-027 D-47, M10-08·O9) works the same way again: Comfortable
// is the default, Compact sets `data-density="compact"` on <html>, and
// tokens.css swaps only the spacing tokens (row heights, paddings, the ribbon's
// group spacing). No pane, dialog or command moves, and no target goes below
// 24 × 24 px (WCAG 2.2 SC 2.5.8).
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
  light: '#2563eb',
  dark: '#0b1120',
};

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

export type Accent = 'blue' | 'teal' | 'indigo' | 'graphite';

/** In the order Settings → Appearance shows them; Blue is the default. */
export const ACCENTS: readonly Accent[] = ['blue', 'teal', 'indigo', 'graphite'];

/** localStorage key, next to the theme's. public/theme-boot.js uses the same. */
export const ACCENT_STORAGE_KEY = 'pdftools.accent';

/**
 * Each accent's filled brand colour (File tab, primary buttons): the same in
 * both themes, white text on it at AA. tokens.css --color-brand and the swatch
 * tokens --accent-swatch-* agree (tests/ui/themeContrast.test.ts); it is also
 * the light title-bar colour.
 */
export const ACCENT_BRAND: Readonly<Record<Accent, string>> = {
  blue: '#2563eb',
  teal: '#0f766e',
  indigo: '#4f46e5',
  graphite: '#475569',
};

const isAccent = (v: unknown): v is Accent => ACCENTS.includes(v as Accent);

export type Density = 'comfortable' | 'compact';

/** In the order Settings → Appearance shows them; Comfortable is the default. */
export const DENSITIES: readonly Density[] = ['comfortable', 'compact'];

/** localStorage key, next to the theme's. public/theme-boot.js uses the same. */
export const DENSITY_STORAGE_KEY = 'pdftools.density';

/** The title-bar colour for a theme and accent: the accent's brand in light, the app background in dark. */
export function themeColor(theme: Theme, accent: Accent): string {
  return theme === 'dark' ? THEME_COLOR.dark : ACCENT_BRAND[accent];
}

/** The stored choice; light when none (or storage is blocked). */
export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : 'light';
  } catch {
    return 'light';
  }
}

/** The stored accent; Blue when none, unknown (or storage is blocked). */
export function readStoredAccent(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccent(v) ? v : 'blue';
  } catch {
    return 'blue';
  }
}

/** The stored density; Comfortable when none, unknown (or storage is blocked). */
export function readStoredDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

let current: Theme = typeof document === 'undefined' ? 'light' : readStoredTheme();
let currentAccent: Accent = typeof document === 'undefined' ? 'blue' : readStoredAccent();
let currentDensity: Density = typeof document === 'undefined' ? 'comfortable' : readStoredDensity();
const listeners = new Set<() => void>();
const accentListeners = new Set<() => void>();
const densityListeners = new Set<() => void>();

function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (current === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  if (currentAccent === 'blue') root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', currentAccent);
  if (currentDensity === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', themeColor(current, currentAccent));
}

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
    applyToDocument();
    return;
  }
  current = theme;
  applyToDocument();
  for (const l of listeners) l();
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

/** Clear all local data: forget the choice and go back to the default. */
export function resetTheme(): void {
  setTheme('light');
}

/** Applies the stored choices (the boot script already did; this keeps the two in step). */
export function initTheme(): void {
  const theme = readStoredTheme();
  const accent = readStoredAccent();
  const density = readStoredDensity();
  const changed = theme !== current;
  const accentChanged = accent !== currentAccent;
  const densityChanged = density !== currentDensity;
  current = theme;
  currentAccent = accent;
  currentDensity = density;
  applyToDocument();
  if (changed) for (const l of listeners) l();
  if (accentChanged) for (const l of accentListeners) l();
  if (densityChanged) for (const l of densityListeners) l();
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

export function getAccent(): Accent {
  return currentAccent;
}

/** Switches the accent now and remembers it on this device (Blue removes the entry). */
export function setAccent(accent: Accent): void {
  try {
    if (accent === 'blue') localStorage.removeItem(ACCENT_STORAGE_KEY);
    else localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // Storage blocked: the accent still changes for this session.
  }
  const changed = accent !== currentAccent;
  currentAccent = accent;
  applyToDocument();
  if (changed) for (const l of accentListeners) l();
}

/** Clear all local data: forget the accent and go back to Blue. */
export function resetAccent(): void {
  setAccent('blue');
}

export function subscribeAccent(onChange: () => void): () => void {
  accentListeners.add(onChange);
  return () => {
    accentListeners.delete(onChange);
  };
}

export function useAccent(): Accent {
  return useSyncExternalStore(subscribeAccent, getAccent, () => 'blue');
}

export function getDensity(): Density {
  return currentDensity;
}

/** Switches the density now and remembers it on this device (Comfortable removes the entry). */
export function setDensity(density: Density): void {
  try {
    if (density === 'comfortable') localStorage.removeItem(DENSITY_STORAGE_KEY);
    else localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Storage blocked: the density still changes for this session.
  }
  const changed = density !== currentDensity;
  currentDensity = density;
  applyToDocument();
  if (changed) for (const l of densityListeners) l();
}

/** View → Compact Density: Compact on, or back to Comfortable. */
export function toggleDensity(): void {
  setDensity(currentDensity === 'compact' ? 'comfortable' : 'compact');
}

/** Clear all local data: forget the density and go back to Comfortable. */
export function resetDensity(): void {
  setDensity('comfortable');
}

export function subscribeDensity(onChange: () => void): () => void {
  densityListeners.add(onChange);
  return () => {
    densityListeners.delete(onChange);
  };
}

export function useDensity(): Density {
  return useSyncExternalStore(subscribeDensity, getDensity, () => 'comfortable');
}
