// Ribbon layout derived from the command table (§8, ADR-001 B6, M1-Q2).
// Pure: unit-tested without React. Unavailable commands are omitted (not
// disabled) and tabs without any available command are hidden.
import {
  COMMANDS,
  HOME_REUSES,
  RIBBON_TABS,
  isAvailable,
  type CommandDef,
  type CommandTab,
} from '../commands';

export interface RibbonGroupLayout {
  /** Label source: the group's own tab (reused Home groups keep their origin label). */
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
    const reused =
      tab === 'home'
        ? HOME_REUSES.map((id) => byId.get(id)).filter((c): c is CommandDef => c !== undefined)
        : [];
    const groups = group([...own, ...reused]);
    if (groups.length) tabs.push({ tab, groups });
  }
  return {
    tabs,
    backstage: shown.filter((c) => c.tab === 'file'),
    quickAccess: shown.filter((c) => c.tab === 'quickAccess'),
  };
}
