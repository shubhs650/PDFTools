// Ribbon layout derived from the command table (§8, ADR-001 B6, M1-Q2).
// Pure: unit-tested without React. Unavailable commands are omitted (not
// disabled) and tabs without any available command are hidden.
import {
  COMMANDS,
  HOME_REUSE_GROUPS,
  RIBBON_TABS,
  isAvailable,
  type CommandDef,
  type CommandTab,
} from '../commands';

export interface RibbonGroupLayout {
  /** Label source: the group's tab (Home's reused commands sit in Home's own groups). */
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
 * Home's copies of other tabs' commands: small, labelled, in Home's own groups
 * (the icons, handlers and ids are the originals').
 */
function homeReuses(byId: Map<string, CommandDef>): CommandDef[] {
  const out: CommandDef[] = [];
  for (const g of HOME_REUSE_GROUPS) {
    for (const id of g.ids) {
      const c = byId.get(id);
      if (!c) continue;
      const copy: CommandDef = { ...c, tab: 'home', group: g.group, size: 'small' };
      delete copy.compact;
      out.push(copy);
    }
  }
  return out;
}

function group(commands: CommandDef[]): RibbonGroupLayout[] {
  const out: RibbonGroupLayout[] = [];
  for (const c of commands) {
    let g = out.find((x) => x.tab === c.tab && x.group === c.group);
    if (!g) out.push((g = { tab: c.tab, group: c.group, commands: [] }));
    g.commands.push(c);
  }
  return out;
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
    const own = shown.filter((c) => c.tab === tab);
    const reused = tab === 'home' ? homeReuses(byId) : [];
    const groups = group([...own, ...reused]);
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
