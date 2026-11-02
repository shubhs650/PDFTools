import { describe, expect, it } from 'vitest';
import { COMMANDS, RIBBON_TABS } from '../../src/app/commands';
import {
  choosePlan,
  commandsAtStep,
  groupCells,
  groupSteps,
  reductionPlans,
  relaxPlan,
  ribbonLayout,
  type GroupStep,
} from '../../src/app/ribbon/layout';

describe('ribbon layout from the command table (§8, ADR-001 B6, M1-Q2)', () => {
  const m1 = ribbonLayout();

  it('shows only tabs with an available command: Home, View, Help, Protect (M2-03), Comment (M3-07/08), Measure (M3-15), Convert (M4-05 … M4-07, M4-13 … M4-15, M5 OCR), M4-08 in Comment', () => {
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
      'convert.ocr', // M5 (ADR-020)
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
    // Redaction (M4-16 … M4-18), Security Info (M2-12), Unlock (M2-03), Password
    // Security and Remove Security (M6-12), Signatures (M2-13), Sign Document (M6-13).
    expect(protect?.groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual([
      'protect.markRedaction',
      'protect.markRedactionArea',
      'protect.applyRedactions',
      'protect.redactionList',
      'protect.securityInfo',
      'protect.unlock',
      'protect.passwordSecurity',
      'protect.removeSecurity',
      'protect.signatures',
      'protect.signDocument',
    ]);
  });

  it('omits unavailable commands instead of disabling them', () => {
    const ids = m1.tabs.flatMap((t) => t.groups.flatMap((g) => g.commands.map((c) => c.id)));
    expect(ids).toContain('home.advancedSearch'); // shipped in M2-09
    expect(ids).not.toContain('view.loupe');
    expect(ids).toContain('view.continuousFacing');
  });

  it('Home repeats available commands from other tabs as small buttons in Home groups (UI01; M6-08 A2b–A2d)', () => {
    const home = m1.tabs.find((t) => t.tab === 'home');
    expect(home?.groups.map((g) => `${g.tab}.${g.group}`)).toEqual([
      'home.tools',
      'home.find',
      'home.forms',
      'home.zoom',
      'home.comment',
      'home.measure',
      'home.rotation',
      'home.view',
      'home.protect',
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
      'comment.callout',
      'comment.line',
      'comment.arrow',
      'comment.rectangle',
      'comment.cloud',
      'comment.stamp',
      'measure.distance',
      // The view turns both ways; the pages turn on Organize (owner's answer 6).
      'view.rotateCw',
      'view.rotateCcw',
      // Home's own Snapshot (M6-09, A2a) leads the View group.
      'home.snapshot',
      'view.propertiesPane',
      'protect.signatures',
    ]);
    expect(copies.every((c) => c.size === 'small' && c.compact === undefined)).toBe(true);
    expect(copies.every((c) => c.tab === 'home')).toBe(true);
    expect(copies.map((c) => c.id)).not.toContain('organize.rotateCw');
  });

  it('Comment follows the review (B7a, B7b): Tools … Manage Comments; review and transfer live in the menus', () => {
    const comment = m1.tabs.find((t) => t.tab === 'comment');
    const ids = (group: string) =>
      comment?.groups.find((g) => g.group === group)?.commands.map((c) => c.id);
    expect(comment?.groups.map((g) => g.group)).toEqual([
      'tools',
      'text',
      'note',
      'textMarkup',
      'drawing',
      'stamp',
      'measure',
      'manage',
    ]);
    expect(ids('tools')).toEqual(['home.hand', 'home.selectText', 'home.selectAnnotations']);
    expect(comment?.groups[0]?.commands.map((c) => c.size)).toEqual(['small', 'small', 'large']);
    expect(ids('text')).toEqual(['comment.typewriter', 'comment.textBox', 'comment.callout']);
    expect(ids('textMarkup')).toEqual([
      'comment.highlight',
      'comment.underline',
      'comment.strikeout',
      'comment.squiggly',
      'comment.insertText',
      'comment.replaceText',
      'comment.highlightArea',
      'comment.inkHighlighter',
    ]);
    expect(ids('drawing')).toEqual([
      'comment.line',
      'comment.arrow',
      'comment.polyline',
      'comment.polygon',
      'comment.rectangle',
      'comment.oval',
      'comment.cloud',
      'comment.pencil',
    ]);
    expect(ids('measure')).toEqual(['measure.distance', 'measure.perimeter', 'measure.area']);
    expect(ids('manage')).toEqual([
      'comment.commentsPane',
      'comment.importComments',
      'comment.exportAnnotations',
      'comment.exportCrs',
      'comment.flatten',
      'comment.stylesPalette',
      'comment.filter',
      'comment.statusSchemes',
      'comment.reviewerProfile',
      'comment.autoNumber',
    ]);
    // Labelled text markup (B7a); the drawing tools stay an icon grid.
    expect(
      comment?.groups.find((g) => g.group === 'textMarkup')?.commands.some((c) => c.compact),
    ).toBe(false);
    expect(
      comment?.groups.find((g) => g.group === 'drawing')?.commands.every((c) => c.compact),
    ).toBe(true);
    const shown = comment?.groups.flatMap((g) => g.commands.map((c) => c.id)) ?? [];
    for (const id of [
      'comment.reply',
      'comment.delete',
      'comment.setStatus',
      'comment.copyStyle',
      'comment.applyStyle',
      'comment.copyComments',
      'comment.pasteComments',
      'comment.pasteToOriginal',
    ])
      expect(shown).not.toContain(id);
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
    const stamp = ribbonLayout()
      .tabs.find((t) => t.tab === 'comment')
      ?.groups.find((g) => g.group === 'stamp');
    expect(groupCells(stamp?.commands ?? []).map((cell) => cell.map((c) => c.id))).toEqual([
      ['comment.stamp'],
      ['comment.imageStamp', 'comment.link'],
    ]);
    expect(groupCells([])).toEqual([]);
  });
});

describe('adaptive steps (D-36)', () => {
  const comment = ribbonLayout().tabs.find((t) => t.tab === 'comment');
  const group = (name: string) => comment?.groups.find((g) => g.group === name)?.commands ?? [];

  it('draws a group large, then small with labels, then icons only, then as one menu button', () => {
    const tools = group('tools');
    expect(commandsAtStep(tools, 0)?.map((c) => c.size)).toEqual(['small', 'small', 'large']);
    expect(commandsAtStep(tools, 1)?.map((c) => [c.size, c.compact])).toEqual([
      ['small', undefined],
      ['small', undefined],
      ['small', undefined],
    ]);
    expect(commandsAtStep(tools, 2)?.every((c) => c.size === 'small' && c.compact)).toBe(true);
    expect(commandsAtStep(tools, 3)).toBeNull();
    // Never the table's own objects.
    expect(tools[2]?.size).toBe('large');
  });

  it('skips steps that change nothing', () => {
    expect(groupSteps(group('tools'))).toEqual([0, 1, 2, 3]);
    expect(groupSteps(group('textMarkup'))).toEqual([0, 2, 3]); // no large buttons
    expect(groupSteps(group('drawing'))).toEqual([0, 3]); // already icons only
    // Sticky Note and Attach File (M6-10): two buttons, so it can fold into a menu.
    expect(groupSteps(group('note'))).toEqual([0, 1, 2, 3]);
  });

  it('steps down one group at a time: a round per step, low priority and then the right first', () => {
    const plans = reductionPlans([
      { steps: [0, 1, 2, 3], priority: 1 }, // A
      { steps: [0, 2, 3], priority: 0 }, // B
      { steps: [0, 1, 2, 3], priority: 0 }, // C
    ]);
    // Order within a round: C (priority 0, rightmost), B (priority 0), A (priority 1).
    expect(plans).toEqual([
      [0, 0, 0],
      [0, 0, 1], // round 1: C; B has no step 1
      [1, 0, 1], // A
      [1, 0, 2], // round 2: C, B, A
      [1, 2, 2],
      [2, 2, 2],
      [2, 2, 3], // round 3: C, B, A
      [2, 3, 3],
      [3, 3, 3],
    ]);
  });

  it('chooses the widest layout that fits; unmeasured layouts are tried; the narrowest when none fits', () => {
    const plans: GroupStep[][] = [
      [0, 0],
      [0, 2],
      [2, 2],
    ];
    const w: Record<string, number> = { '0.0': 300, '0.2': 200, '1.0': 400, '1.2': 100 };
    const of = (g: number, s: GroupStep) => w[`${String(g)}.${String(s)}`];
    expect(choosePlan(plans, of, 800)).toBe(0); // 700
    expect(choosePlan(plans, of, 700)).toBe(0);
    expect(choosePlan(plans, of, 699)).toBe(1); // 400
    expect(choosePlan(plans, of, 350)).toBe(2); // 300
    expect(choosePlan(plans, of, 100)).toBe(2);
    expect(choosePlan(plans, () => undefined, 10)).toBe(0);
    expect(choosePlan([], of, 10)).toBe(0);
  });

  it('gives the room left back: high priority first, the largest step that still fits', () => {
    const groups = [
      { steps: [0, 1, 2] as GroupStep[], priority: 2 }, // a large button: small is wider here
      { steps: [0, 2, 3] as GroupStep[], priority: 0 },
      { steps: [0, 1, 2, 3] as GroupStep[], priority: 1 },
    ];
    const w: Record<string, number> = {
      '0.0': 80,
      '0.1': 100,
      '0.2': 40,
      '1.0': 360,
      '1.2': 110,
      '1.3': 70,
      '2.0': 250,
      '2.1': 140,
      '2.2': 90,
    };
    const of = (g: number, s: GroupStep) => w[`${String(g)}.${String(s)}`];
    // From (1, 2, 1) = 350: group 0 → 0 (80, narrower), group 2 → 0 (+110), group 1 stays.
    expect(relaxPlan([1, 2, 1], groups, of, 450)).toEqual([0, 2, 0]);
    // Less room: group 2 only to its small buttons.
    expect(relaxPlan([1, 2, 1], groups, of, 340)).toEqual([0, 2, 1]);
    // Nothing fits better: unchanged; unmeasured widths: unchanged.
    expect(relaxPlan([2, 3, 2], groups, of, 200)).toEqual([2, 3, 2]);
    expect(relaxPlan([1, 2, 1], groups, () => undefined, 9999)).toEqual([1, 2, 1]);
  });

  it('every tab has a layout for every width: its last plan folds every group it can', () => {
    for (const tab of ribbonLayout().tabs) {
      const plans = reductionPlans(
        tab.groups.map((g) => ({ steps: groupSteps(g.commands), priority: 0 })),
      );
      const last = plans.at(-1) ?? [];
      tab.groups.forEach((g, i) => {
        expect(last[i]).toBe(groupSteps(g.commands).at(-1));
      });
      // Each plan changes exactly one group by one of its steps.
      for (let p = 1; p < plans.length; p++)
        expect(plans[p]?.filter((s, i) => s !== plans[p - 1]?.[i])).toHaveLength(1);
    }
  });
});
