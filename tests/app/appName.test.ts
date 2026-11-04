// Product name "Triya PDF" (M7-01, ADR-023 D-41): every user-visible place says
// it, from the one `app.name` key; what users never see, or what would lose
// their data if renamed (storage names, the PWA id, file format ids), stays.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import { i18n, t } from '../../src/i18n';
import { APP_NAME } from '../../src/i18n/appName';
import { MANIFEST } from '../../src/app/manifest';
import { DB_NAME } from '../../src/storage/idb';
import { APP_FILES_CACHE } from '../../src/features/settings/storedData';
import { TEST_HOOK_GLOBAL } from '../../src/testing/hook';
import {
  STYLE_FILE_FORMAT,
  STYLE_FILE_SUFFIX,
  parseStyles,
} from '../../src/features/annotate/tools/stylePalette';
import { FORMAT, SCHEME_FILE_SUFFIX, importScheme } from '../../src/model/statusScheme';

const OLD = /PDF\s?Tools/i;

function leaves(tree: unknown, prefix = ''): [string, string][] {
  if (typeof tree === 'string') return [[prefix.slice(0, -1), tree]];
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, `${prefix}${k}.`),
  );
}

// Keys from the scan are plain strings, outside the typed key set.
const untypedT = i18n.t.bind(i18n) as unknown as (key: string, o: object) => string;

describe('product name (D-41)', () => {
  it('lives in one key, app.name', () => {
    expect(en.app.name).toBe('Triya PDF');
    expect(APP_NAME).toBe(en.app.name);
    const named = leaves(en).filter(([, v]) => v.includes('Triya'));
    expect(named.map(([k]) => k)).toEqual(['app.name']);
  });

  it('no message names the old product; the others use {{app}}', () => {
    const all = leaves(en);
    expect(all.filter(([, v]) => OLD.test(v))).toEqual([]);
    const withApp = all.filter(([, v]) => v.includes('{{app}}'));
    expect(withApp.length).toBeGreaterThanOrEqual(35);
    for (const [k] of withApp) {
      const text = untypedT(k, { version: '1.0', browser: 'B', os: 'O', name: 'n', count: 1 });
      expect(text, k).toContain('Triya PDF');
      expect(text, k).not.toContain('{{app}}');
    }
  });

  it('is filled in for real calls (Help title, privacy, error body)', () => {
    expect(t('help.title')).toBe('Triya PDF Help');
    expect(t('error.body')).toContain('This part of Triya PDF stopped working.');
    expect(t('app.name')).toBe('Triya PDF');
  });

  it('names the installed app and the browser tab', () => {
    expect(MANIFEST.name).toBe('Triya PDF');
    expect(MANIFEST.short_name).toBe('Triya PDF');
    expect(MANIFEST.description).not.toMatch(OLD);
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<title>Triya PDF</title>');
    expect(html).not.toMatch(OLD);
  });

  it('suggests the new export file names', () => {
    expect(STYLE_FILE_SUFFIX).toBe('.triyapdf-styles.json');
    expect(SCHEME_FILE_SUFFIX).toBe('.triyapdf-scheme.json');
  });
});

describe('kept as it was (D-41: not user-visible, or would lose data)', () => {
  it('keeps the PWA id, so installed apps update in place', () => {
    expect(MANIFEST.id).toBe('/');
    expect(MANIFEST.start_url).toBe('/');
  });

  it('keeps storage names and the test hook', () => {
    expect(DB_NAME).toBe('pdftools');
    expect(APP_FILES_CACHE.test('pdftools-0a1b2c')).toBe(true);
    expect(TEST_HOOK_GLOBAL).toBe('__pdftoolsTest');
  });

  it('keeps the file format ids, so files saved before the rename still import', () => {
    expect(STYLE_FILE_FORMAT).toBe('pdftools-styles');
    expect(FORMAT).toBe('pdftools-scheme');
    // A `.pdftools-styles.json` from an earlier version: the content decides, not the name.
    let n = 0;
    const styles = parseStyles(
      JSON.stringify({
        format: 'pdftools-styles',
        version: 1,
        tools: { square: [{ name: 'Old blue', props: { strokeColor: '#0000FF' } }] },
      }),
      () => `id${String(++n)}`,
    );
    expect(styles.ok).toBe(true);
    // A `.pdftools-scheme.json` from an earlier version.
    const scheme = importScheme(
      JSON.stringify({
        format: 'pdftools-scheme',
        version: 1,
        scheme: { name: 'Old', codes: [{ code: 'A', label: 'Approved', color: '#107c10' }] },
      }),
      'x',
    );
    expect(scheme.errors).toEqual([]);
    expect(scheme.scheme?.name).toBe('Old');
  });
});
