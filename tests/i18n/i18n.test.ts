import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import { createFormatters } from '../../src/i18n/format';
import { i18n, t, type MessageKey } from '../../src/i18n';
import { PSEUDO_EXPANSION, pseudoLocalize, pseudoResources } from '../../src/i18n/pseudo';

function leaves(tree: unknown, prefix = ''): string[] {
  if (typeof tree === 'string') return [prefix.slice(0, -1)];
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, `${prefix}${k}.`),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
  });
}

/** Keys referenced as `t('…')`, `msg('…')` or `i18nKey="…"` in /src. */
function referencedKeys(): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:t|msg)\(\s*['"`]([\w.-]+)['"`]|i18nKey=\{?['"]([\w.-]+)['"]/g;
  for (const file of sourceFiles('src')) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) found.add(m[1] ?? m[2] ?? '');
  }
  return found;
}

describe('message keys (rule 11)', () => {
  const keys = new Set(leaves(en));
  const used = referencedKeys();

  it('every key referenced in src exists in en.json', () => {
    expect([...used].filter((k) => !keys.has(k))).toEqual([]);
  });

  it('every key in en.json is referenced somewhere in src', () => {
    expect([...keys].filter((k) => !used.has(k))).toEqual([]);
  });

  it('en.json has only non-empty string leaves', () => {
    for (const k of keys) expect(t(k as MessageKey)).not.toBe('');
  });
});

describe('t()', () => {
  it('translates typed keys synchronously', () => {
    expect(t('app.shell.label')).toBe('PDFTools application');
    // @ts-expect-error unknown keys are a type error
    expect(t('app.nope')).toBe('app.nope');
  });

  it('interpolates without HTML escaping (React escapes)', () => {
    i18n.addResource('en', 'translation', 'test.greet', 'Hello {{name}}');
    // A key added at runtime is outside the typed key set, so call t() untyped.
    const untypedT = i18n.t.bind(i18n) as unknown as (key: string, o: object) => string;
    expect(untypedT('test.greet', { name: '<b>' })).toBe('Hello <b>');
  });
});

describe('format helpers (Intl only)', () => {
  const us = createFormatters('en-US');
  const deRaw = createFormatters('de-DE');
  // Intl picks locale-specific spaces (NBSP / narrow NBSP); compare with plain spaces.
  const sp = (s: string): string => s.replace(/\s/g, ' ');
  const de = {
    number: (v: number) => sp(deRaw.number(v)),
    percent: (v: number) => sp(deRaw.percent(v)),
    zoom: (v: number) => sp(deRaw.zoom(v)),
    bytes: (v: number) => sp(deRaw.bytes(v)),
    date: (v: Date) => sp(deRaw.date(v)),
    relative: (v: number, now: number) => sp(deRaw.relative(v, now)),
  };

  it('numbers and percentages follow the locale', () => {
    expect(us.number(1234.567)).toBe('1,234.57');
    expect(de.number(1234.567)).toBe('1.234,57');
    expect(us.percent(0.256)).toBe('25.6%');
    expect(de.percent(0.256)).toBe('25,6 %');
  });

  it('zoom shows whole percent, one decimal below 10 %', () => {
    expect(us.zoom(1.25)).toBe('125%');
    expect(us.zoom(64)).toBe('6,400%');
    expect(us.zoom(0.015)).toBe('1.5%');
    expect(de.zoom(64)).toBe('6.400 %');
  });

  it('bytes use decimal units', () => {
    expect(us.bytes(999)).toBe('999 byte');
    expect(us.bytes(1_500_000)).toBe('1.5 MB');
    expect(de.bytes(23_400_000)).toBe('23,4 MB');
  });

  it('dates and relative times', () => {
    const d = new Date(Date.UTC(2026, 8, 25, 12, 0));
    expect(us.date(d)).toBe('Sep 25, 2026');
    expect(de.date(d)).toBe('25.09.2026');
    const now = d.getTime();
    expect(us.relative(now - 3 * 60_000, now)).toBe('3 minutes ago');
    expect(us.relative(now - 86_400_000, now)).toBe('yesterday');
    expect(de.relative(now - 86_400_000, now)).toBe('gestern');
  });
});

describe('pseudo-locale (§8.2, +40 %)', () => {
  it('accents letters, expands by at least 40 % and brackets', () => {
    const src = 'Save Optimized';
    const out = pseudoLocalize(src);
    expect(out.startsWith('[Šáṽé')).toBe(true);
    expect(out.endsWith(']')).toBe(true);
    expect(out.length - 2).toBeGreaterThanOrEqual(Math.ceil(src.length * (1 + PSEUDO_EXPANSION)));
  });

  it('keeps placeholders and tags intact', () => {
    expect(pseudoLocalize('Page {{n}} of <0>{{total}}</0>')).toContain('{{n}}');
    expect(pseudoLocalize('Page {{n}} of <0>{{total}}</0>')).toContain('<0>{{total}}</0>');
  });

  it('maps a whole resource tree', () => {
    const tree = pseudoResources(en);
    expect(tree.app.shell.label).toMatch(/^\[ÞĎ|^\[Þ/);
  });
});
