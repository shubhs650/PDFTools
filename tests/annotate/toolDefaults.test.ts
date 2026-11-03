import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKUP_DEFAULTS, MARKUP_TOOLS } from '../../src/features/annotate/tools/markupModel';
import { DRAW_TOOLS } from '../../src/features/annotate/tools/drawModel';
import {
  cleanProps,
  defaultsPatch,
  effectiveDefaults,
  migrateStored,
  SHIPPED_DEFAULTS,
  STYLE_TOOLS,
  TOOL_DEFAULTS_VERSION,
} from '../../src/features/annotate/tools/toolDefaults';
import { AppDb, MIGRATIONS } from '../../src/storage/idb';

let factory = new IDBFactory();
let db: Promise<AppDb> | undefined;
vi.mock('../../src/storage/appDb', () => ({
  appDb: () => (db ??= AppDb.open({ factory })),
}));

const opened = (): Promise<AppDb> => (db ??= AppDb.open({ factory }));

const store = await import('../../src/features/annotate/tools/toolDefaultsStore');

describe('shipped comment styles (M6-03, D-37, B6)', () => {
  it('text box, typewriter and callout: red text at 10 pt', () => {
    for (const tool of ['freeText', 'typewriter', 'freeTextCallout'] as const) {
      expect(SHIPPED_DEFAULTS[tool]).toMatchObject({ fontColor: '#FF0000', fontSize: 10 });
      expect(SHIPPED_DEFAULTS[tool].color).toBe('transparent');
    }
    // Text box and callout have a red 1 pt border; a typewriter has none.
    expect(SHIPPED_DEFAULTS.freeText).toMatchObject({ strokeColor: '#FF0000', strokeWidth: 1 });
    expect(SHIPPED_DEFAULTS.freeTextCallout).toMatchObject({
      strokeColor: '#FF0000',
      strokeWidth: 1,
    });
    expect(SHIPPED_DEFAULTS.typewriter.strokeWidth).toBe(0);
  });

  it('lines, shapes, cloud and pencil: red 1 pt, no fill', () => {
    for (const tool of [
      'line',
      'lineArrow',
      'polyline',
      'polygon',
      'square',
      'circle',
      'cloud',
    ] as const) {
      expect(SHIPPED_DEFAULTS[tool]).toEqual({
        strokeColor: '#FF0000',
        strokeWidth: 1,
        color: 'transparent',
      });
    }
    expect(SHIPPED_DEFAULTS.ink).toMatchObject({ strokeColor: '#FF0000', strokeWidth: 1 });
  });

  it('highlight and sticky note keep yellow; measurements keep their own', () => {
    // The highlight has a style (its palette, M6-07), still the yellow of before.
    expect(SHIPPED_DEFAULTS.highlight).toEqual({
      strokeColor: MARKUP_DEFAULTS.highlight.color,
      color: MARKUP_DEFAULTS.highlight.color,
      opacity: 1,
    });
    // M6-17: the other markups, the free highlight and the sticky note joined
    // the styled tools with the look they had before.
    for (const m of ['underline', 'strikeout', 'squiggly'] as const)
      expect(SHIPPED_DEFAULTS[m]).toEqual({
        strokeColor: MARKUP_DEFAULTS[m].color,
        color: MARKUP_DEFAULTS[m].color,
        opacity: 1,
      });
    expect(SHIPPED_DEFAULTS.textComment).toEqual({ strokeColor: '#FFCD45', opacity: 1 });
    expect(SHIPPED_DEFAULTS.inkHighlighter).toMatchObject({
      strokeColor: '#FFCD45',
      strokeWidth: 14,
    });
    expect(SHIPPED_DEFAULTS.highlightArea).toMatchObject({ color: '#FFE14D', strokeWidth: 0 });
    for (const m of ['measureDistance', 'measurePerimeter', 'measureArea'])
      expect(STYLE_TOOLS).not.toContain(m);
    expect(MARKUP_DEFAULTS.highlight.color).toBe('#FFE14D');
  });

  it('every styled tool is a drawing tool or a text markup tool', () => {
    for (const tool of STYLE_TOOLS)
      expect([...DRAW_TOOLS, ...MARKUP_TOOLS] as string[]).toContain(tool);
  });
});

describe('stored overrides and their migration', () => {
  it('the user’s properties win over the shipped ones, per tool', () => {
    const o = { square: { strokeColor: '#0000FF', strokeWidth: 3 } };
    expect(effectiveDefaults('square', o)).toEqual({
      strokeColor: '#0000FF',
      strokeWidth: 3,
      color: 'transparent',
    });
    expect(effectiveDefaults('circle', o)).toEqual(SHIPPED_DEFAULTS.circle);
  });

  it('keeps only well-formed properties', () => {
    expect(
      cleanProps({
        strokeColor: '#00ff00',
        color: 'transparent',
        fontColor: 'red',
        fontSize: 0,
        strokeWidth: 2.5,
        opacity: 2,
        contents: 'never a style',
      }),
    ).toEqual({ strokeColor: '#00ff00', color: 'transparent', strokeWidth: 2.5 });
    expect(cleanProps(null)).toEqual({});
    expect(cleanProps('x')).toEqual({});
  });

  it('keeps the Tool Properties fields too (M6-06), well-formed only', () => {
    expect(
      cleanProps({
        strokeStyle: 2,
        strokeDashArray: [3, 3],
        cloudyBorderIntensity: 2,
        lineEndings: { start: 0, end: 5 },
        fontFamily: 9,
        textAlign: 1,
        verticalAlign: 2,
      }),
    ).toEqual({
      strokeStyle: 2,
      strokeDashArray: [3, 3],
      cloudyBorderIntensity: 2,
      lineEndings: { start: 0, end: 5 },
      fontFamily: 9,
      textAlign: 1,
      verticalAlign: 2,
    });
    expect(
      cleanProps({
        strokeStyle: 1.5,
        strokeDashArray: [3, -1],
        cloudyBorderIntensity: 9,
        lineEndings: { start: 0 },
        fontFamily: 12, // Symbol is not a text font
        textAlign: 3,
        verticalAlign: '1',
      }),
    ).toEqual({});
  });

  it('migrates v1 records; drops damaged, empty and newer ones', () => {
    expect(migrateStored({ v: 1, props: { fontSize: 12 } })).toEqual({
      v: TOOL_DEFAULTS_VERSION,
      props: { fontSize: 12 },
    });
    expect(migrateStored({ v: 1, props: { fontSize: 'big' } })).toBeNull();
    expect(migrateStored({ v: 2, props: { fontSize: 12 } })).toBeNull();
    expect(migrateStored({ props: { fontSize: 12 } })).toBeNull();
    expect(migrateStored(undefined)).toBeNull();
  });

  it('a patch clears what is no longer set (the plugin merges patches)', () => {
    expect(defaultsPatch({ a: 1, b: 2 }, { a: 3 })).toEqual({ a: 3, b: undefined });
    expect('b' in defaultsPatch({ a: 1, b: 2 }, { a: 3 })).toBe(true);
  });
});

describe('toolDefaults store (IndexedDB v5)', () => {
  beforeEach(() => {
    factory = new IDBFactory();
    db = undefined;
    store.resetAllToolDefaults();
  });

  it('an existing v4 database gains an empty store: everyone starts on the shipped defaults', async () => {
    const v4 = await AppDb.open({ factory, migrations: MIGRATIONS.slice(0, 4) });
    await v4.setSetting('theme', 'dark');
    v4.close();
    await store.loadToolDefaults();
    const v5 = await opened();
    expect(v5.db.version).toBe(MIGRATIONS.length);
    expect(await v5.getSetting('theme')).toBe('dark');
    expect(await v5.listToolDefaults()).toEqual([]);
    expect(store.toolDefaultsStore.getState()).toMatchObject({ overrides: {}, loaded: true });
    expect(store.defaultsFor('line')).toEqual(SHIPPED_DEFAULTS.line);
  });

  it('saves only what the user set, and reads it back after a restart', async () => {
    await store.loadToolDefaults();
    await store.setToolDefaults('freeText', { fontSize: 14 });
    await store.setToolDefaults('freeText', { fontColor: '#0000FF' });
    expect(await (await opened()).listToolDefaults()).toEqual([
      ['freeText', { v: 1, props: { fontSize: 14, fontColor: '#0000FF' } }],
    ]);
    // A restart: memory is empty, the database is not.
    store.resetAllToolDefaults();
    await store.loadToolDefaults();
    expect(store.defaultsFor('freeText')).toEqual({
      ...SHIPPED_DEFAULTS.freeText,
      fontSize: 14,
      fontColor: '#0000FF',
    });
    await store.resetToolDefaults('freeText');
    expect(store.defaultsFor('freeText')).toEqual(SHIPPED_DEFAULTS.freeText);
    expect(await (await opened()).listToolDefaults()).toEqual([]);
  });

  it('skips damaged records and tools it does not know', async () => {
    const d = await opened();
    await d.putToolDefaults('square', { v: 1, props: { strokeWidth: 'thick' } });
    await d.putToolDefaults('teleporter', { v: 1, props: { strokeWidth: 2 } });
    await d.putToolDefaults('circle', { v: 1, props: { strokeWidth: 2 } });
    await store.loadToolDefaults();
    expect(store.toolDefaultsStore.getState().overrides).toEqual({ circle: { strokeWidth: 2 } });
  });

  it('Clear all local data empties the store', async () => {
    const d = await opened();
    await d.putToolDefaults('circle', { v: 1, props: { strokeWidth: 2 } });
    await store.loadToolDefaults();
    await d.clearAll();
    store.resetAllToolDefaults();
    expect(store.defaultsFor('circle')).toEqual(SHIPPED_DEFAULTS.circle);
    await store.loadToolDefaults();
    expect(store.defaultsFor('circle')).toEqual(SHIPPED_DEFAULTS.circle);
  });
});
