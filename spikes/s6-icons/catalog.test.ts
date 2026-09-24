import { describe, expect, it } from 'vitest';
import { loadCatalog, parseAtom, resolve, type IconEntry } from './catalog.ts';
import { COMMANDS, HOME_REUSES } from './commands.ts';

describe('parseAtom', () => {
  it('collects sizes per style, skips Light and unsized exports, keeps digits in base names', () => {
    const m = new Map<string, IconEntry>();
    parseAtom(
      'save',
      `export declare const SaveColor: FluentIcon;
export declare const Save16Regular: FluentIcon;
export declare const Save20Regular: FluentIcon;
export declare const Save20Filled: FluentIcon;
export declare const Save32Light: FluentIcon;
export declare const Save32Color: FluentIcon;
export declare const Keyboard12320Regular: FluentIcon;`,
      m,
    );
    const e = m.get('Save');
    expect(e?.atom).toBe('save');
    expect([...(e?.sizes.Regular ?? [])]).toEqual([16, 20]);
    expect([...(e?.sizes.Filled ?? [])]).toEqual([20]);
    expect([...(e?.sizes.Color ?? [])]).toEqual([32]);
    expect([...(m.get('Keyboard123')?.sizes.Regular ?? [])]).toEqual([20]);
  });
});

describe('S6 icon map against @fluentui/react-icons', () => {
  const cat = loadCatalog();

  it('command ids are unique and Home reuses point at real commands', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of HOME_REUSES) expect(ids).toContain(r);
  });

  it('every command names a Fluent icon usable in Regular (20 px, and >= 24 px for large)', () => {
    const bad = COMMANDS.map((c) => resolve(c, cat))
      .filter((r) => !r.entry || !r.fit.Regular.ok)
      .map((r) => `${r.cmd.id}: ${r.cmd.fluent}`);
    expect(bad).toEqual([]);
  });

  it('every §8 custom icon is on the custom list', () => {
    const custom = new Set(COMMANDS.filter((c) => c.custom).map((c) => c.id));
    for (const id of [
      'comment.cloud',
      'measure.calibrate',
      'measure.scaleViewport',
      'comment.exportCrs',
    ])
      expect(custom).toContain(id);
  });
});
