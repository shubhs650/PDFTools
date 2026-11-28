// @vitest-environment jsdom
// Light / dark theme (M7-11, ADR-023 D-42): light by default, stored on this
// device, applied to <html> and the title-bar colour; the boot script that
// runs before the first paint agrees with the module.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENT_BRAND,
  ACCENT_STORAGE_KEY,
  ACCENTS,
  DENSITIES,
  DENSITY_STORAGE_KEY,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  getAccent,
  getDensity,
  getTheme,
  initTheme,
  readStoredAccent,
  readStoredDensity,
  readStoredTheme,
  resetAccent,
  resetDensity,
  resetTheme,
  setAccent,
  setDensity,
  setTheme,
  subscribeAccent,
  subscribeDensity,
  subscribeTheme,
  toggleDensity,
  toggleTheme,
} from '../../src/app/theme';
import { KEYMAP } from '../../src/app/keys/keymap';
import { COMMANDS } from '../../src/app/commands';
import { LOCAL_DATA } from '../../src/features/settings/storedData';
import { MANIFEST } from '../../src/app/manifest';

const root = () => document.documentElement;
const meta = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#2563eb" />';
  root().removeAttribute('data-theme');
  root().removeAttribute('data-accent');
  root().removeAttribute('data-density');
  initTheme();
});
afterEach(() => {
  localStorage.clear();
});

describe('theme store', () => {
  it('is light by default and when the stored value is unknown', () => {
    expect(readStoredTheme()).toBe('light');
    expect(getTheme()).toBe('light');
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readStoredTheme()).toBe('light');
  });

  it('switches <html>, the title-bar colour and the stored choice, and notifies', () => {
    let calls = 0;
    const off = subscribeTheme(() => (calls += 1));
    setTheme('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(meta()).toBe(THEME_COLOR.dark);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(calls).toBe(1);
    toggleTheme();
    expect(getTheme()).toBe('light');
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(meta()).toBe(THEME_COLOR.light);
    // Light is the default, so nothing is kept for it.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(calls).toBe(2);
    setTheme('light');
    expect(calls).toBe(2);
    off();
  });

  it('reads the stored choice at start, and Clear all local data resets it', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    initTheme();
    expect(getTheme()).toBe('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    resetTheme();
    expect(getTheme()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('still switches when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      setTheme('dark');
      expect(root().getAttribute('data-theme')).toBe('dark');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('accent colour (M10 O7, D-47)', () => {
  it('is Blue by default and when the stored value is unknown', () => {
    expect(readStoredAccent()).toBe('blue');
    expect(getAccent()).toBe('blue');
    localStorage.setItem(ACCENT_STORAGE_KEY, 'magenta');
    expect(readStoredAccent()).toBe('blue');
    expect(ACCENTS).toEqual(['blue', 'teal', 'indigo', 'graphite']);
  });

  it('switches <html>, the light title bar and the stored choice, and notifies', () => {
    let calls = 0;
    const off = subscribeAccent(() => (calls += 1));
    setAccent('teal');
    expect(root().getAttribute('data-accent')).toBe('teal');
    expect(meta()).toBe(ACCENT_BRAND.teal);
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('teal');
    expect(calls).toBe(1);
    // In dark the title bar is the app background, whatever the accent.
    setTheme('dark');
    expect(meta()).toBe(THEME_COLOR.dark);
    setTheme('light');
    expect(meta()).toBe(ACCENT_BRAND.teal);
    // Blue is the default: no attribute, nothing stored.
    setAccent('blue');
    expect(root().hasAttribute('data-accent')).toBe(false);
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull();
    expect(meta()).toBe(THEME_COLOR.light);
    expect(calls).toBe(2);
    off();
  });

  it('reads the stored choice at start, and Clear all local data resets it', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'graphite');
    initTheme();
    expect(getAccent()).toBe('graphite');
    expect(root().getAttribute('data-accent')).toBe('graphite');
    resetAccent();
    expect(getAccent()).toBe('blue');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull();
  });

  it('Blue is the brand the light title bar and the manifest already use', () => {
    expect(ACCENT_BRAND.blue).toBe(THEME_COLOR.light);
  });
});

describe('density store (M10-08·O9)', () => {
  it('is comfortable by default and when the stored value is unknown', () => {
    expect(DENSITIES).toEqual(['comfortable', 'compact']);
    expect(getDensity()).toBe('comfortable');
    localStorage.setItem(DENSITY_STORAGE_KEY, 'tiny');
    expect(readStoredDensity()).toBe('comfortable');
  });

  it('switches <html> and the stored choice, and notifies; the theme and accent stay', () => {
    let calls = 0;
    const off = subscribeDensity(() => (calls += 1));
    setAccent('teal');
    setDensity('compact');
    expect(root().getAttribute('data-density')).toBe('compact');
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact');
    expect(root().getAttribute('data-accent')).toBe('teal');
    expect(meta()).toBe(ACCENT_BRAND.teal);
    expect(calls).toBe(1);
    setDensity('compact');
    expect(calls).toBe(1);
    // Comfortable is the default: no attribute, nothing stored.
    toggleDensity();
    expect(getDensity()).toBe('comfortable');
    expect(root().hasAttribute('data-density')).toBe(false);
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBeNull();
    expect(calls).toBe(2);
    off();
  });

  it('reads the stored choice at start, and Clear all local data resets it', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, 'compact');
    initTheme();
    expect(getDensity()).toBe('compact');
    expect(root().getAttribute('data-density')).toBe('compact');
    resetDensity();
    expect(getDensity()).toBe('comfortable');
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBeNull();
  });
});

describe('boot script (public/theme-boot.js)', () => {
  const source = readFileSync('public/theme-boot.js', 'utf8');
  const boot = (
    stored: string | null,
    accent: string | null = null,
    density: string | null = null,
  ) => {
    root().removeAttribute('data-theme');
    root().removeAttribute('data-accent');
    root().removeAttribute('data-density');
    document.head.innerHTML = '<meta name="theme-color" content="#2563eb" />';
    const storage = {
      getItem: (k: string) =>
        k === THEME_STORAGE_KEY
          ? stored
          : k === ACCENT_STORAGE_KEY
            ? accent
            : k === DENSITY_STORAGE_KEY
              ? density
              : null,
    };
    runInNewContext(source, { document, localStorage: storage });
  };

  it('applies a stored compact density with the module’s key, and nothing else', () => {
    boot(null, null, 'compact');
    expect(root().getAttribute('data-density')).toBe('compact');
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(meta()).toBe(THEME_COLOR.light);
    boot('dark', 'indigo', 'compact');
    expect(root().getAttribute('data-density')).toBe('compact');
    expect(meta()).toBe(THEME_COLOR.dark);
    for (const other of [null, 'comfortable', 'tiny']) {
      boot(null, null, other);
      expect(root().hasAttribute('data-density')).toBe(false);
    }
  });

  it('applies a stored accent with the module’s key and colours, in light and dark', () => {
    for (const a of ACCENTS.filter((x) => x !== 'blue')) {
      boot(null, a);
      expect(root().getAttribute('data-accent')).toBe(a);
      expect(meta()).toBe(ACCENT_BRAND[a]);
      boot('dark', a);
      expect(root().getAttribute('data-accent')).toBe(a);
      expect(meta()).toBe(THEME_COLOR.dark);
    }
    boot(null, 'blue');
    expect(root().hasAttribute('data-accent')).toBe(false);
    boot(null, 'toString');
    expect(root().hasAttribute('data-accent')).toBe(false);
    expect(meta()).toBe(THEME_COLOR.light);
  });

  it('applies a stored dark theme with the module’s key and colour', () => {
    boot('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(meta()).toBe(THEME_COLOR.dark);
  });

  it('leaves the light default alone', () => {
    boot(null);
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(meta()).toBe(THEME_COLOR.light);
  });

  it('runs in <head> before the app, as a classic (blocking) script', () => {
    const html = readFileSync('index.html', 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toMatch(/<script src="\/theme-boot\.js"><\/script>/);
    expect(head.indexOf('name="theme-color"')).toBeLessThan(head.indexOf('theme-boot.js'));
    expect(html).toContain(`content="${THEME_COLOR.light}"`);
    expect(MANIFEST.theme_color).toBe(THEME_COLOR.light);
  });
});

describe('where the theme is reached', () => {
  it('is a toggle command in View → Window with a shortcut', () => {
    const cmd = COMMANDS.find((c) => c.id === 'view.darkTheme');
    expect(cmd).toMatchObject({
      tab: 'view',
      group: 'window',
      toggle: true,
      fluent: 'WeatherMoon',
    });
    const binding = KEYMAP.find((b) => b.target === 'view.darkTheme');
    expect(binding?.chords).toHaveLength(1);
  });

  it('density is a toggle command in View → Window', () => {
    expect(COMMANDS.find((c) => c.id === 'view.compactDensity')).toMatchObject({
      tab: 'view',
      group: 'window',
      toggle: true,
      fluent: 'TextDensity',
      shipped: true,
    });
  });

  it('is listed with the data kept on this device, and cleared (the accent and density too)', () => {
    const items = LOCAL_DATA.filter((d) => d.kind === 'localStorage');
    expect(items.map((d) => d.location)).toEqual([
      THEME_STORAGE_KEY,
      ACCENT_STORAGE_KEY,
      DENSITY_STORAGE_KEY,
      // What's new's record (M10-08·O6), not a look-and-feel choice.
      'pdftools.whatsNewSeen',
      // The comment fonts chosen last (M11-07), not a look-and-feel choice either.
      'pdftools.recentFonts',
      // The close-out list's Hide highlights choice (M12-27).
      'pdftools.closeOutHideHighlights',
      // Compare's first-time tips were seen (M12-26).
      'pdftools.compareTipsSeen',
      // The Measure loupe and automatic snapping choices (M13-02).
      'pdftools.measureLoupe',
      // How Radius and Diameter are picked (M14-05).
      'pdftools.measureCurveMethod',
      // Thin Lines on (M13-05).
      'pdftools.thinLines',
    ]);
    expect(items.every((d) => d.cleared)).toBe(true);
  });
});
