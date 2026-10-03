import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_MILESTONES,
  COMMANDS,
  HOME_REUSES,
  RIBBON_TABS,
  isAvailable,
} from '../src/app/commands';
import { commandLabelKey, groupLabelKey, tabLabelKey } from '../src/app/commandLabels';
import en from '../src/i18n/en.json';
import { CUSTOM_GLYPHS } from '../src/ui/icons/custom';
import { scalePath } from '../src/ui/icons/custom/paths';
import { glyphsFor, iconFor } from '../src/ui/icons/registry';
import { generate, OUT } from '../scripts/gen-icons.ts';

const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe('command table (M1-06)', () => {
  it('has unique ids; Home reuses point at real commands', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of HOME_REUSES) expect(ids).toContain(r);
  });

  it('has an en.json label for every command, ribbon tab and ribbon group (rule 11)', () => {
    const missing: string[] = [];
    for (const c of COMMANDS) {
      if (typeof lookup(commandLabelKey(c.id)) !== 'string') missing.push(commandLabelKey(c.id));
      if ((RIBBON_TABS as readonly string[]).includes(c.tab)) {
        if (typeof lookup(groupLabelKey(c)) !== 'string') missing.push(groupLabelKey(c));
      }
    }
    for (const t of RIBBON_TABS)
      if (typeof lookup(tabLabelKey(t)) !== 'string') missing.push(tabLabelKey(t));
    expect(missing).toEqual([]);
  });

  it('shows M1 … M5 commands (M4 complete, M4-22; M5 OCR, ADR-020); the rest are omitted (M1-Q2)', () => {
    expect(AVAILABLE_MILESTONES).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    // Every M2 … M4 command works: none is left for the milestone flag alone to show.
    expect(
      COMMANDS.filter(
        (c) =>
          (c.milestone === 'M2' || c.milestone === 'M3' || c.milestone === 'M4') &&
          c.shipped !== true,
      ).map((c) => c.id),
    ).toEqual([]);
    const available = COMMANDS.filter(isAvailable).map((c) => c.id);
    expect(available).toContain('protect.unlock'); // shipped in M2-03
    expect(available).toContain('file.saveOptimized');
    expect(available).toContain('view.zoomIn');
    expect(available).toContain('comment.highlight'); // shipped in M3-08
    expect(available).toContain('comment.cloud'); // shipped in M3-09
    expect(available).toContain('comment.exportCrs'); // shipped in M3-19
    expect(available).toContain('comment.exportAnnotations'); // M4-08
    expect(available).toContain('organize.delete'); // M4-09
    expect(available).toContain('home.resetForm'); // shipped in M2-14
    expect(available).toContain('home.find'); // shipped in M2-07
    expect(available).toContain('home.advancedSearch'); // shipped in M2-09
  });

  it('keeps the §8 custom icons on the custom list', () => {
    for (const id of [
      'comment.cloud',
      'measure.calibrate',
      'measure.scaleViewport',
      'comment.exportCrs',
    ]) {
      const c = COMMANDS.find((x) => x.id === id);
      expect(c?.custom ?? c?.customPending, id).toBeTruthy();
    }
  });
});

describe('M3 custom icons (M3-06)', () => {
  it('no M3 command waits for a custom icon; each has Regular and Filled glyphs', () => {
    const m3 = COMMANDS.filter((c) => c.milestone === 'M3');
    expect(m3.filter((c) => c.customPending).map((c) => c.id)).toEqual([]);
    for (const c of m3.filter((x) => x.custom)) {
      const g = CUSTOM_GLYPHS[c.custom ?? ''];
      expect(g?.regular.small, c.id).toBeTruthy();
      if (c.toggle) expect(g?.filled?.small, c.id).toBeTruthy();
      if (c.size === 'large') expect(g?.regular.large, c.id).toBeTruthy();
    }
  });
});

describe('M4 custom icons (M4-03)', () => {
  it('no M4 command waits for a custom icon; each has Regular, 32 px and pressed glyphs', () => {
    const m4 = COMMANDS.filter((c) => c.milestone === 'M4');
    expect(m4.filter((c) => c.customPending).map((c) => c.id)).toEqual([]);
    const custom = m4.filter((x) => x.custom).map((c) => c.id);
    expect(custom.sort()).toEqual([
      'convert.word',
      'protect.applyRedactions',
      'protect.markRedaction',
      'protect.markRedactionArea',
    ]);
    for (const c of m4.filter((x) => x.custom)) {
      const g = CUSTOM_GLYPHS[c.custom ?? ''];
      expect(g?.regular.small, c.id).toBeTruthy();
      expect(g?.regular.large, c.id).toBeTruthy();
      if (c.toggle) expect(g?.filled?.small, c.id).toBeTruthy();
    }
  });

  it('render at 20 and 32 px in currentColor, with the pressed state drawn differently', () => {
    for (const id of ['protect.markRedaction', 'protect.markRedactionArea']) {
      const plain = renderToStaticMarkup(createElement(iconFor(id)));
      const pressed = renderToStaticMarkup(createElement(iconFor(id, { pressed: true })));
      expect(plain).toContain('viewBox="0 0 20 20"');
      expect(pressed).not.toBe(plain);
    }
    for (const id of ['convert.word', 'protect.applyRedactions']) {
      const large = renderToStaticMarkup(createElement(iconFor(id, { large: true })));
      expect(large).toContain('viewBox="0 0 32 32"');
      expect(large).not.toMatch(/fill="#|stroke="#/);
      expect(large).toContain('aria-hidden="true"');
    }
  });
});

describe('icon registry (ADR-010)', () => {
  it('the generated Fluent imports are up to date with the command table', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(generate());
  });

  it('every command resolves: small, large for large commands, Filled for toggles', () => {
    for (const c of COMMANDS) {
      const g = glyphsFor(c.id);
      expect(g.regular.small, c.id).toBeTypeOf('object');
      if (c.size === 'large') expect(g.regular.large, `${c.id} large`).toBeDefined();
      if (c.toggle) expect(g.filled?.small, `${c.id} filled`).toBeDefined();
      expect(iconFor(c.id, { large: true, pressed: true })).toBeDefined();
    }
  });

  it('custom icons exist for every command marked custom, and none are orphaned', () => {
    const marked = COMMANDS.filter((c) => c.custom)
      .map((c) => c.id)
      .sort();
    expect(Object.keys(CUSTOM_GLYPHS).sort()).toEqual(marked);
  });

  it('custom icons render like Fluent icons: sized viewBox, aria-hidden, currentColor paths', () => {
    const html = renderToStaticMarkup(
      createElement(iconFor('file.saveOptimized', { large: true })),
    );
    expect(html).toContain('viewBox="0 0 32 32"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/fill="#|stroke="#/);
    const small = renderToStaticMarkup(createElement(iconFor('view.continuousFacing')));
    expect(small).toContain('viewBox="0 0 20 20"');
  });

  it('nothing imports the @fluentui/react-icons root barrel', () => {
    const offenders = files('src').filter((f) =>
      /from\s+['"]@fluentui\/react-icons['"]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('scalePath scales every coordinate', () => {
    expect(scalePath('M2 2H9.5L12 4.5v1Z', 1.6)).toBe('M3.2 3.2H15.2L19.2 7.2v1.6Z');
  });
});
