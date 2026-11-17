import { describe, expect, it } from 'vitest';
import { COMMANDS, isAvailable } from '../../src/app/commands';
import { commandLabelKey } from '../../src/app/commandLabels';
import { ribbonLayout } from '../../src/app/ribbon/layout';
import { t } from '../../src/i18n';
import {
  commandIndex,
  normalize,
  searchCommands,
  words,
  type SearchItem,
} from '../../src/features/tellMe/commandSearch';

// M10-08·O2 (ADR-027): Tell me finds any command by name. Pure parts: the index
// (which commands, where they live) and the ranking.

const index = commandIndex();
const where = (id: string): string[] | undefined =>
  index.find((e) => e.id === id)?.where.map((k) => t(k));
const items: SearchItem[] = index.map((e) => ({
  id: e.id,
  label: t(commandLabelKey(e.id)),
  where: e.where.map((k) => t(k)).join(' › '),
}));
const ids = (query: string): string[] => searchCommands(items, query).map((r) => r.id);

describe('command index', () => {
  it('lists every command on the ribbon once', () => {
    const onRibbon = new Set(
      ribbonLayout().tabs.flatMap((tab) => tab.groups.flatMap((g) => g.commands.map((c) => c.id))),
    );
    const listed = index.map((e) => e.id);
    expect(new Set(listed).size).toBe(listed.length);
    for (const id of onRibbon) expect(listed, id).toContain(id);
  });

  it('places a command at its own tab, not at a copy on Home', () => {
    expect(where('comment.highlight')).toEqual(['Comment', 'Text Markup']);
    expect(where('view.zoomIn')).toEqual(['View', 'Zoom']);
    expect(where('measure.distance')?.[0]).toBe('Measure');
  });

  it('places a command shown only as a copy at its first copy', () => {
    const def = COMMANDS.find((c) => c.id === 'home.selectText');
    expect(def?.reuseOnly).toBe(true);
    expect(where('home.selectText')).toEqual(['Comment', 'Tools']);
  });

  it('has File, Quick Access (only what File lacks), panes and the top bar', () => {
    expect(where('file.about')).toEqual(['File']);
    expect(where('file.settings')).toEqual(['File']);
    expect(where('qat.undo')).toEqual(['Quick Access']);
    expect(index.some((e) => e.id === 'qat.open' || e.id === 'qat.save')).toBe(false);
    expect(where('rail.layers')).toEqual(['Side panes']);
    expect(where('view.fullScreen')).toEqual(['Top bar']);
    expect(where('app.reportIssue')).toEqual(['Top bar']);
  });

  it('never lists itself, context-menu-only, status or unavailable commands', () => {
    const listed = new Set(index.map((e) => e.id));
    expect(listed.has('app.tellMe')).toBe(false);
    expect(listed.has('view.exitFullScreen')).toBe(false);
    for (const c of COMMANDS) {
      if (c.tab === 'menu' || c.tab === 'status' || !isAvailable(c))
        expect(listed.has(c.id), c.id).toBe(false);
    }
  });

  it('keeps the ribbon order (tab by tab)', () => {
    const tabOf = index
      .filter((e) => e.where.length === 2)
      .map((e) => t(e.where[0] ?? 'ribbon.tab.home'));
    const order = ribbonLayout().tabs.map((tab) => t(`ribbon.tab.${tab.tab}` as never));
    const seen = [...new Set(tabOf)];
    expect(seen).toEqual(order.filter((x) => seen.includes(x)));
  });
});

describe('search (on Enter only, rule 3)', () => {
  it('normalizes case and accents, and splits on punctuation', () => {
    expect(normalize('Résumé')).toBe('resume');
    expect(words('Sign Document…')).toEqual(['sign', 'document']);
    expect(words('  ')).toEqual([]);
  });

  it('finds nothing for an empty query', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('ranks the exact label first, then labels that start with it', () => {
    expect(ids('highlight')[0]).toBe('comment.highlight');
    expect(ids('HIGHLIGHT')[0]).toBe('comment.highlight');
    const zoom = ids('zoom in');
    expect(zoom[0]).toBe('view.zoomIn');
  });

  it('matches word starts in any order', () => {
    expect(ids('clockwise rot')).toEqual(
      expect.arrayContaining(['view.rotateCw', 'organize.rotateCw']),
    );
    expect(ids('rotate')).toEqual(
      expect.arrayContaining([
        'view.rotateCw',
        'view.rotateCcw',
        'organize.rotateCw',
        'organize.rotateCcw',
      ]),
    );
    // A word of the place picks the copy: Organize's rotates the pages.
    expect(ids('rotate clockwise organize')[0]).toBe('organize.rotateCw');
  });

  it('matches inside a label after word starts', () => {
    const r = searchCommands(
      [
        { id: 'a', label: 'Watermark', where: 'X › Y' },
        { id: 'b', label: 'Mark Up', where: 'X › Y' },
      ],
      'mark',
    ).map((x) => x.id);
    expect(r).toEqual(['b', 'a']);
  });

  it('matches through the place last ("measure" lists the Measure tab)', () => {
    const r = ids('measure');
    expect(r.length).toBeGreaterThan(3);
    expect(items.find((i) => i.id === r[0])?.where).toMatch(/^Measure › /);
    expect(r).toEqual(expect.arrayContaining(['measure.distance', 'measure.area']));
  });

  it('needs every word to match', () => {
    expect(ids('highlight zzz')).toEqual([]);
    expect(ids('qwertyuiop')).toEqual([]);
  });

  it('keeps the ribbon order between equal matches', () => {
    const r = searchCommands(
      [
        { id: 'one', label: 'Delete Pages', where: '' },
        { id: 'two', label: 'Delete Comment', where: '' },
      ],
      'delete',
    ).map((x) => x.id);
    expect(r).toEqual(['one', 'two']);
  });
});
