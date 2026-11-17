// Tell me (M10-08·O2, ADR-027): which commands can be found, where each one lives,
// and the search itself. Pure: no React, no stores, unit-tested. The search runs
// only when the user presses Enter or the Search button (rule 3), over about 150
// short labels, so it is plain string work on the main thread (well under 1 ms).
import { msg, type MessageKey } from '../../i18n/keys';
import { COMMANDS, isAvailable, type CommandDef } from '../../app/commands';
import { groupLabelKey, tabLabelKey } from '../../app/commandLabels';
import { ribbonLayout, type RibbonLayout } from '../../app/ribbon/layout';

/** A command the search can find, and where it lives (shown beside it). */
export interface CommandEntry {
  id: string;
  /** Label keys of its place, outermost first: [tab, group], or one key. */
  where: readonly MessageKey[];
}

/** Commands that are never results: this one, and the full-screen button's other face. */
const NOT_FOUND = new Set(['app.tellMe', 'view.exitFullScreen']);

/**
 * Every command the user can reach, once, in ribbon order: each at its own tab and
 * group when it has one there (Highlight at Comment › Text Markup, not at its copy on
 * Home), otherwise at its first copy (Select Text at Comment › Tools); then File's
 * entries, Undo and Redo from Quick Access (its Open, Save and Print are File's), the
 * side panes the ribbon does not show, and the top bar's buttons.
 */
export function commandIndex(
  layout: RibbonLayout = ribbonLayout(),
  commands: readonly CommandDef[] = COMMANDS,
): CommandEntry[] {
  const home = new Map(commands.map((c) => [c.id, c]));
  const out: CommandEntry[] = [];
  const seen = new Set<string>(NOT_FOUND);
  const add = (id: string, where: readonly MessageKey[]): void => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, where });
  };
  const ribbon = layout.tabs.flatMap((tab) =>
    tab.groups.flatMap((g) =>
      g.commands.map((c) => ({
        id: c.id,
        own: home.get(c.id)?.tab === tab.tab,
        where: [tabLabelKey(tab.tab), groupLabelKey(g)] as const,
      })),
    ),
  );
  for (const r of ribbon) if (r.own) add(r.id, r.where);
  for (const r of ribbon) add(r.id, r.where);
  for (const c of layout.backstage) add(c.id, [tabLabelKey('file')]);
  const fileIds = new Set(layout.backstage.map((c) => c.id));
  for (const c of layout.quickAccess) {
    if (!fileIds.has(c.id.replace(/^qat\./, 'file.'))) add(c.id, [msg('tellMe.where.quickAccess')]);
  }
  for (const c of commands.filter(isAvailable)) {
    if (c.tab === 'rail') add(c.id, [msg('tellMe.where.panes')]);
    else if (c.tab === 'topBar') add(c.id, [msg('tellMe.where.topBar')]);
  }
  return out;
}

/** A result's text, already in the user's language. */
export interface SearchItem {
  id: string;
  label: string;
  /** Its place ("Comment › Drawing"). */
  where: string;
}

/** Lower case, without accents, so "resume" finds "Résumé" (the user's own locale). */
export const normalize = (s: string): string =>
  s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** The words of a text: letters and digits, punctuation and the "…" of a label dropped. */
export const words = (s: string): string[] =>
  normalize(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);

/**
 * The items that match the query, best first. Every word of the query must start a
 * word of the label or of its place, or appear inside the label ("mark" finds
 * "Watermark"). Ranking: the whole label, then a label that starts with the query,
 * then labels whose words the query starts, then labels that contain the words, then
 * matches through the place only ("measure" lists the Measure tab after Measure
 * Distance); ties keep the ribbon's order. An empty query finds nothing.
 */
export function searchCommands(items: readonly SearchItem[], query: string): SearchItem[] {
  const q = words(query);
  if (q.length === 0) return [];
  const phrase = q.join(' ');
  const ranked: { item: SearchItem; rank: number; order: number }[] = [];
  items.forEach((item, order) => {
    const label = words(item.label);
    const where = words(item.where);
    const labelText = label.join(' ');
    const startsLabel = (w: string): boolean => label.some((l) => l.startsWith(w));
    const inLabel = (w: string): boolean => labelText.includes(w);
    const startsWhere = (w: string): boolean => where.some((l) => l.startsWith(w));
    if (!q.every((w) => startsLabel(w) || inLabel(w) || startsWhere(w))) return;
    const rank =
      labelText === phrase
        ? 0
        : labelText.startsWith(phrase)
          ? 1
          : q.every(startsLabel)
            ? 2
            : q.every(inLabel)
              ? 3
              : 4;
    ranked.push({ item, rank, order });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((r) => r.item);
}
