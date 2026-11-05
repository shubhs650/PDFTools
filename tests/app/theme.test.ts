// @vitest-environment jsdom
// Light / dark theme (M7-11, ADR-023 D-42): light by default, stored on this
// device, applied to <html> and the title-bar colour; the boot script that
// runs before the first paint agrees with the module.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_COLOR,
  THEME_STORAGE_KEY,
  getTheme,
  initTheme,
  readStoredTheme,
  resetTheme,
  setTheme,
  subscribeTheme,
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
  document.head.innerHTML = '<meta name="theme-color" content="#0f6cbd" />';
  root().removeAttribute('data-theme');
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

describe('boot script (public/theme-boot.js)', () => {
  const source = readFileSync('public/theme-boot.js', 'utf8');
  const boot = (stored: string | null) => {
    root().removeAttribute('data-theme');
    document.head.innerHTML = '<meta name="theme-color" content="#0f6cbd" />';
    const storage = { getItem: (k: string) => (k === THEME_STORAGE_KEY ? stored : null) };
    runInNewContext(source, { document, localStorage: storage });
  };

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

  it('is listed with the data kept on this device, and cleared', () => {
    const item = LOCAL_DATA.find((d) => d.kind === 'localStorage');
    expect(item).toMatchObject({ location: THEME_STORAGE_KEY, cleared: true });
  });
});
