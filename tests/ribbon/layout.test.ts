import { describe, expect, it } from 'vitest';
import { COMMANDS, RIBBON_TABS } from '../../src/app/commands';
import { groupCells, ribbonLayout } from '../../src/app/ribbon/layout';

describe('ribbon layout from the command table (§8, ADR-001 B6, M1-Q2)', () => {
  const m1 = ribbonLayout();

  it('shows only tabs with an available command: Home, View, Help, Protect (M2-03), Comment (M3-07/08), Measure (M3-15), Convert (M4-05 … M4-07, M4-13 … M4-15), M4-08 in Comment', () => {
    expect(m1.tabs.map((t) => t.tab)).toEqual([
      'home',
      'view',
      'comment',
      'measure',
      'organize',
      'convert',
      'protect',
      'help',
    ]);
    const convert = m1.tabs.find((t) => t.tab === 'convert');
    expect(convert?.groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual([
      'convert.text',
      'convert.markdown',
      'convert.html',
      'convert.word',
      'convert.images',
      'convert.expressExtract',
      'convert.reviewExtract',
      'convert.tableTemplates',
    ]);
    const comment = m1.tabs.find((t) => t.tab === 'comment');
    // Grows task by task in M3: what works is shown, the rest is omitted.
    const shown = comment?.groups.flatMap((g) => g.commands.map((c) => c.id)) ?? [];
    for (const id of [
      'comment.highlight',
      'comment.stickyNote',
      'comment.link',
      'comment.reviewerProfile',
    ])
      expect(shown).toContain(id);
    expect(shown).toContain('comment.exportCrs'); // M3-19
    expect(shown).toContain('comment.exportAnnotations'); // M4-08
    const protect = m1.tabs.find((t) => t.tab === 'protect');
    // Redaction (M4-16 … M4-18), Security Info (M2-12), Unlock (M2-03), Signatures (M2-13).
    expect(protect?.groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual([
      'protect.markRedaction',
      'protect.markRedactionArea',
      'protect.applyRedactions',
      'protect.redactionList',
      'protect.securityInfo',
      'protect.unlock',
      'protect.signatures',
    ]);
  });

  it('omits unavailable commands instead of disabling them', () => {
    const ids = m1.tabs.flatMap((t) => t.groups.flatMap((g) => g.commands.map((c) => c.id)));
    expect(ids).toContain('home.advancedSearch'); // shipped in M2-09
    expect(ids).not.toContain('view.loupe');
    expect(ids).toContain('view.continuousFacing');
  });

  it('Home repeats available commands from other tabs as small buttons in Home groups (preview review UI01)', () => {
    const home = m1.tabs.find((t) => t.tab === 'home');
    expect(home?.groups.map((g) => `${g.tab}.${g.group}`)).toEqual([
      'home.tools',
      'home.find',
      'home.forms',
      'home.zoom',
      'home.comment',
      'home.measure',
      'home.pages',
      'home.protect',
    ]);
    expect(home?.groups[3]?.commands.map((c) => c.id)).toEqual([
      'view.zoomIn',
      'view.zoomOut',
      'view.fitPage',
      'view.fitWidth',
    ]);
    // Copies keep the original's id, icon and short label; large tools become small
    // and icon-only tool grids get their labels back.
    const copies = home?.groups.slice(3).flatMap((g) => g.commands) ?? [];
    expect(copies.map((c) => c.id)).toEqual([
      'view.zoomIn',
      'view.zoomOut',
      'view.fitPage',
      'view.fitWidth',
      'comment.highlight',
      'comment.stickyNote',
      'comment.textBox',
      'comment.cloud',
      'comment.stamp',
      'measure.distance',
      'organize.rotateCw',
      'protect.signatures',
    ]);
    expect(copies.every((c) => c.size === 'small' && c.compact === undefined)).toBe(true);
    expect(copies.find((c) => c.id === 'comment.textBox')?.short).toBe(true);
  });

  it('Comment keeps the selection actions together and the tool grids compact (UI01/OBS01)', () => {
    const comment = m1.tabs.find((t) => t.tab === 'comment');
    expect(comment?.groups.map((g) => g.group)).toEqual([
      'textMarkup',
      'note',
      'text',
      'drawing',
      'stamp',
      'comments',
      'review',
      'transfer',
    ]);
    expect(comment?.groups[6]?.commands.map((c) => c.id)).toEqual([
      'comment.reply',
      'comment.delete',
      'comment.setStatus',
      'comment.copyStyle',
      'comment.applyStyle',
    ]);
    for (const g of ['textMarkup', 'drawing'])
      expect(comment?.groups.find((x) => x.group === g)?.commands.every((c) => c.compact)).toBe(
        true,
      );
  });

  it('builds the File backstage and quick access toolbar', () => {
    expect(m1.backstage.map((c) => c.id)).toEqual([
      'file.open',
      'file.recent',
      'file.save',
      'file.saveAs',
      'file.saveOptimized',
      'file.print', // M2-15
      'file.exportPrintReady', // M2-16
      'file.properties',
      'file.settings',
      'file.about',
      'file.privacy',
    ]);
    expect(m1.quickAccess.map((c) => c.id)).toEqual([
      'qat.open',
      'qat.save',
      'qat.print',
      'qat.undo', // M3-05
      'qat.redo', // M3-05
    ]);
  });

  it('shows every §8 tab once every milestone is available', () => {
    const all = ribbonLayout(COMMANDS, () => true);
    expect(all.tabs.map((t) => t.tab)).toEqual(RIBBON_TABS.filter((t) => t !== 'file'));
  });
});

describe('group cells (UI01)', () => {
  it('keeps large buttons on their own and runs of small buttons together', () => {
    const transfer = ribbonLayout()
      .tabs.find((t) => t.tab === 'comment')
      ?.groups.find((g) => g.group === 'transfer');
    expect(groupCells(transfer?.commands ?? []).map((cell) => cell.map((c) => c.id))).toEqual([
      [
        'comment.importComments',
        'comment.exportAnnotations',
        'comment.copyComments',
        'comment.pasteComments',
        'comment.pasteToOriginal',
      ],
      ['comment.exportCrs'],
    ]);
    expect(groupCells([])).toEqual([]);
  });
});
