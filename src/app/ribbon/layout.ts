// Ribbon layout derived from the command table (§8, ADR-001 B6, M1-Q2).
// Pure: unit-tested without React. Unavailable commands are omitted (not
// disabled) and tabs without any available command are hidden.
import {
  COMMANDS,
  GROUP_ORDER,
  GROUP_PRIORITY,
  REUSE_GROUPS,
  RIBBON_TABS,
  isAvailable,
  type CommandDef,
  type CommandTab,
} from '../commands';

export interface RibbonGroupLayout {
  /** Label source: the group's tab (reused commands sit in the tab's own groups). */
  tab: CommandTab;
  group: string;
  commands: CommandDef[];
}

export interface RibbonTabLayout {
  tab: CommandTab;
  groups: RibbonGroupLayout[];
}

export interface RibbonLayout {
  /** Ribbon tabs after File (File opens the backstage). */
  tabs: RibbonTabLayout[];
  /** File backstage entries, in order. */
  backstage: CommandDef[];
  /** Quick access toolbar. */
  quickAccess: CommandDef[];
}

/**
 * A tab's copies of other tabs' commands (REUSE_GROUPS): the icons, handlers
 * and ids are the originals'; small and labelled unless listed as large, or
 * icons only in a `compact` group (M7-09).
 */
function reuses(tab: CommandTab, byId: Map<string, CommandDef>): CommandDef[] {
  const out: CommandDef[] = [];
  for (const g of REUSE_GROUPS) {
    if (g.tab !== tab) continue;
    for (const id of g.ids) {
      const c = byId.get(id);
      if (!c) continue;
      const size = g.large?.includes(id) ? 'large' : 'small';
      const copy: CommandDef = { ...c, tab, group: g.group, size };
      if (g.compact) copy.compact = true;
      else delete copy.compact;
      delete copy.reuseOnly;
      out.push(copy);
    }
  }
  return out;
}

function group(commands: CommandDef[], order: readonly string[] = []): RibbonGroupLayout[] {
  const out: RibbonGroupLayout[] = [];
  for (const c of commands) {
    let g = out.find((x) => x.tab === c.tab && x.group === c.group);
    if (!g) out.push((g = { tab: c.tab, group: c.group, commands: [] }));
    g.commands.push(c);
  }
  const rank = (g: RibbonGroupLayout): number => {
    const i = order.indexOf(g.group);
    return i < 0 ? order.length : i;
  };
  // A stable sort: groups the order doesn't name keep their place after the named ones.
  return out
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map((x) => x.g);
}

export function ribbonLayout(
  commands: readonly CommandDef[] = COMMANDS,
  available: (c: CommandDef) => boolean = isAvailable,
): RibbonLayout {
  const shown = commands.filter(available);
  const byId = new Map(shown.map((c) => [c.id, c]));
  const tabs: RibbonTabLayout[] = [];
  for (const tab of RIBBON_TABS) {
    if (tab === 'file') continue;
    const own = shown.filter((c) => c.tab === tab && c.reuseOnly !== true);
    const groups = group([...own, ...reuses(tab, byId)], GROUP_ORDER[tab]);
    if (groups.length) tabs.push({ tab, groups });
  }
  return {
    tabs,
    backstage: shown.filter((c) => c.tab === 'file'),
    quickAccess: shown.filter((c) => c.tab === 'quickAccess'),
  };
}

/**
 * A group's buttons in cells: each large button is a cell of its own; a run of
 * small buttons is one cell that flows down three rows, column by column (the
 * Office/PDF-XChange ribbon density), so a group mixing one large and many
 * small buttons never becomes a single long row (preview review UI01).
 */
export function groupCells(commands: readonly CommandDef[]): CommandDef[][] {
  const cells: CommandDef[][] = [];
  for (const c of commands) {
    const last = cells[cells.length - 1];
    if (c.size === 'small' && last && last[0]?.size === 'small') last.push(c);
    else cells.push([c]);
  }
  return cells;
}

// ------------------------------------------------------------ adaptive steps (D-36)

/**
 * How a group is drawn as the window narrows (D-36, Office behaviour):
 * 0 as designed; 1 large buttons become small, labelled ones; 2 icons only;
 * 3 one button that opens the group as a menu.
 */
export type GroupStep = 0 | 1 | 2 | 3;
export const STEP_FULL = 0;
export const STEP_SMALL = 1;
export const STEP_ICONS = 2;
export const STEP_MENU = 3;

/** The group's commands as drawn at `step` (null: collapsed into its menu button). */
export function commandsAtStep(
  commands: readonly CommandDef[],
  step: GroupStep,
): CommandDef[] | null {
  if (step === STEP_MENU) return null;
  if (step === STEP_FULL) return [...commands];
  return commands.map((c) => ({
    ...c,
    size: 'small',
    ...(step === STEP_ICONS ? { compact: true as const } : {}),
  }));
}

/** The steps that change how a group looks, in order (0 always; 3 only with 2+ commands). */
export function groupSteps(commands: readonly CommandDef[]): GroupStep[] {
  const steps: GroupStep[] = [STEP_FULL];
  if (commands.some((c) => c.size === 'large')) steps.push(STEP_SMALL);
  if (commands.some((c) => c.compact !== true)) steps.push(STEP_ICONS);
  if (commands.length > 1) steps.push(STEP_MENU);
  return steps;
}

export const groupKey = (g: Pick<RibbonGroupLayout, 'tab' | 'group'>): string =>
  `${g.tab}.${g.group}`;

/** A group's priority (GROUP_PRIORITY, default 0): higher steps down later. */
export const groupPriority = (g: Pick<RibbonGroupLayout, 'tab' | 'group'>): number =>
  GROUP_PRIORITY[groupKey(g)] ?? 0;

/**
 * Every layout of a tab from the widest to the narrowest, one group stepping
 * down at a time (D-36): first every group to small buttons, then to icons,
 * then to menus; within a round the lowest priority goes first, and of equal
 * ones the rightmost. Each layout lists one step per group. Pure.
 */
export function reductionPlans(
  groups: readonly { steps: readonly GroupStep[]; priority: number }[],
): GroupStep[][] {
  const order = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.priority - b.g.priority || b.i - a.i);
  let current: GroupStep[] = groups.map(() => STEP_FULL);
  const plans: GroupStep[][] = [current];
  for (const round of [STEP_SMALL, STEP_ICONS, STEP_MENU] as const) {
    for (const { g, i } of order) {
      // The furthest step this round allows that the group has.
      const to = g.steps.filter((s) => s <= round).at(-1) ?? STEP_FULL;
      if (to <= (current[i] ?? STEP_FULL)) continue;
      current = current.map((s, j) => (j === i ? to : s));
      plans.push(current);
    }
  }
  return plans;
}

/**
 * The widest layout that fits `available` pixels: `widthOf(group, step)` is the
 * measured width (undefined when not measured yet, assumed to fit). The last
 * (narrowest) layout when none fits; the ribbon then scrolls. Pure.
 */
export function choosePlan(
  plans: readonly (readonly GroupStep[])[],
  widthOf: (group: number, step: GroupStep) => number | undefined,
  available: number,
): number {
  for (let p = 0; p < plans.length; p++) {
    let total = 0;
    let known = true;
    for (const [g, step] of (plans[p] ?? []).entries()) {
      const w = widthOf(g, step);
      if (w === undefined) known = false;
      else total += w;
    }
    if (!known || total <= available) return p;
  }
  return Math.max(0, plans.length - 1);
}

/**
 * The chosen layout with the room left given back (D-36): groups in the
 * reverse of the order they step down (highest priority, then leftmost, first)
 * take the largest of their steps up to their own that still fits. A round
 * steps every group down before any goes further, so without this a narrow
 * window could leave room unused beside small groups. Pure.
 */
export function relaxPlan(
  plan: readonly GroupStep[],
  groups: readonly { steps: readonly GroupStep[]; priority: number }[],
  widthOf: (group: number, step: GroupStep) => number | undefined,
  available: number,
): GroupStep[] {
  const out = [...plan];
  const width = (g: number, s: GroupStep): number => widthOf(g, s) ?? Number.POSITIVE_INFINITY;
  let total = out.reduce<number>((sum, s, g) => sum + width(g, s), 0);
  if (!Number.isFinite(total)) return out;
  const order = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.priority - a.g.priority || a.i - b.i);
  for (const { g, i } of order) {
    const now = out[i] ?? STEP_FULL;
    for (const s of g.steps) {
      if (s >= now) break;
      const next = total - width(i, now) + width(i, s);
      if (next <= available) {
        out[i] = s;
        total = next;
        break;
      }
    }
  }
  return out;
}
