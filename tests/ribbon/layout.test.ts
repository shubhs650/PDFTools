import { describe, expect, it } from 'vitest';
import { COMMANDS, RIBBON_TABS } from '../../src/app/commands';
import { ribbonLayout } from '../../src/app/ribbon/layout';

describe('ribbon layout from the command table (§8, ADR-001 B6, M1-Q2)', () => {
  const m1 = ribbonLayout();

  it('shows only tabs with an available command: Home, View, Help, Protect (M2-03), Comment (M3-07/08), Measure (M3-15), Convert (M4-05)', () => {
    expect(m1.tabs.map((t) => t.tab)).toEqual([
      'home',
      'view',
      'comment',
      'measure',
      'convert',
      'protect',
      'help',
    ]);
    const convert = m1.tabs.find((t) => t.tab === 'convert');
    expect(convert?.groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual([
      'convert.text',
      'convert.markdown',
      'convert.html',
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
    expect(shown).not.toContain('comment.exportAnnotations'); // M4 (M3-Q1)
    const protect = m1.tabs.find((t) => t.tab === 'protect');
    // Only what works: Security Info (M2-12), Unlock (M2-03), Signatures (M2-13); redaction (M4) and the rest stay omitted.
    expect(protect?.groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual([
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

  it('Home repeats available commands from other tabs under their own group labels', () => {
    const home = m1.tabs.find((t) => t.tab === 'home');
    expect(home?.groups.map((g) => `${g.tab}.${g.group}`)).toEqual([
      'home.tools',
      'home.find',
      'home.forms',
      'view.zoom',
      'comment.textMarkup', // Highlight (M3-08)
      'comment.text', // Text box (M3-09)
      'comment.note', // Sticky note (M3-09)
      'comment.drawing', // Cloud (M3-09)
      'comment.stamp', // Stamp (M3-14)
      'measure.measure', // Distance (M3-16)
      'protect.security', // Signatures (M2-13)
    ]);
    expect(home?.groups[3]?.commands.map((c) => c.id)).toEqual([
      'view.zoomIn',
      'view.zoomOut',
      'view.fitPage',
      'view.fitWidth',
    ]);
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
