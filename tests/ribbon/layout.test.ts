import { describe, expect, it } from 'vitest';
import { COMMANDS, RIBBON_TABS } from '../../src/app/commands';
import { ribbonLayout } from '../../src/app/ribbon/layout';

describe('ribbon layout from the command table (§8, ADR-001 B6, M1-Q2)', () => {
  const m1 = ribbonLayout();

  it('shows only tabs with an available command: Home, View, Help, and Protect from M2-03', () => {
    expect(m1.tabs.map((t) => t.tab)).toEqual(['home', 'view', 'protect', 'help']);
    const protect = m1.tabs.find((t) => t.tab === 'protect');
    // Only what works: Unlock (M2-03); redaction (M4) and the rest stay omitted.
    expect(protect?.groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual(['protect.unlock']);
  });

  it('omits unavailable commands instead of disabling them', () => {
    const ids = m1.tabs.flatMap((t) => t.groups.flatMap((g) => g.commands.map((c) => c.id)));
    expect(ids).not.toContain('home.find');
    expect(ids).not.toContain('view.loupe');
    expect(ids).toContain('view.continuousFacing');
  });

  it('Home repeats available commands from other tabs under their own group labels', () => {
    const home = m1.tabs.find((t) => t.tab === 'home');
    expect(home?.groups.map((g) => `${g.tab}.${g.group}`)).toEqual(['home.tools', 'view.zoom']);
    expect(home?.groups[1]?.commands.map((c) => c.id)).toEqual([
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
      'file.settings',
      'file.about',
      'file.privacy',
    ]);
    expect(m1.quickAccess.map((c) => c.id)).toEqual(['qat.open', 'qat.save']);
  });

  it('shows every §8 tab once every milestone is available', () => {
    const all = ribbonLayout(COMMANDS, () => true);
    expect(all.tabs.map((t) => t.tab)).toEqual(RIBBON_TABS.filter((t) => t !== 'file'));
  });
});
