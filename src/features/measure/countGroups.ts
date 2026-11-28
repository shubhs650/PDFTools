// Count groups (M14-07, D-75, Q14, Q15): chosen or made in the Count group box
// of the Properties pane before clicking; a group has a name, a symbol shape,
// a colour (the standard swatch picker) and a size. The groups made and the
// last one used are remembered on this device (localStorage; listed on the
// Privacy page, removed by Clear all local data). A document's own counts
// bring their groups with them: a group the document already uses is drawn as
// its counts are. Numbers start at 1 per group and run across every page; a
// deleted count leaves its gap and the next one takes the highest plus one;
// Renumber group closes the gaps in one undo step. No PDF work (rule 1).
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { t } from '../../i18n';
import {
  cleanGroupName,
  COUNT_SHAPES,
  DEFAULT_COUNT_SIZE,
  groupOf,
  nextNumber,
  renumber,
  sameGroupName,
  type CountGroup,
} from '../../model/measureCount';
import { metaOf, type MeasureMeta } from '../../model/measureMarkup';
import { measurePoints } from '../../model/measurement';
import { joinStep } from '../annotate/historyJoin';
import { annotationCapability } from '../annotate/selection';
import { metaFor, withFileMeta } from './measurements';

/** localStorage key (storage names keep "pdftools", D-41). */
import { COUNT_GROUPS_STORAGE_KEY } from './countKeys';
export { COUNT_GROUPS_STORAGE_KEY };

/** New groups take these colours in turn (all in the standard swatches). */
export const GROUP_COLORS: readonly string[] = [
  '#ff0000',
  '#0000ff',
  '#008000',
  '#c06000',
  '#800080',
  '#008080',
  '#c000c0',
  '#804000',
];

interface Stored {
  groups: CountGroup[];
  /** The last group used (Q14). */
  current: string;
}

interface CountGroupsState extends Stored {
  /** Set once read from storage (or once nothing was there). */
  ready: true;
}

/** The first group anyone gets: "Item", a red circle. */
export function defaultGroup(): CountGroup {
  return {
    name: cleanGroupName(t('measure.count.defaultGroup')),
    shape: 'circle',
    color: GROUP_COLORS[0] ?? '#ff0000',
    size: DEFAULT_COUNT_SIZE,
  };
}

/** The stored groups, or none for anything unreadable. */
export function parseCountGroups(raw: string | null): Stored {
  try {
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const list = Array.isArray(o['groups']) ? o['groups'] : [];
    const groups: CountGroup[] = [];
    for (const g of list) {
      const ok = groupOf(g);
      if (ok && !groups.some((x) => sameGroupName(x.name, ok.name))) groups.push(ok);
    }
    const current = typeof o['current'] === 'string' ? cleanGroupName(o['current']) : '';
    return { groups, current };
  } catch {
    return { groups: [], current: '' };
  }
}

function read(): Stored {
  try {
    return parseCountGroups(localStorage.getItem(COUNT_GROUPS_STORAGE_KEY));
  } catch {
    return { groups: [], current: '' };
  }
}

export const countGroupsStore = createStore<CountGroupsState>()(() => ({ ...read(), ready: true }));

export function useCountGroups<T>(selector: (s: CountGroupsState) => T): T {
  return useStore(countGroupsStore, selector);
}

function save(next: Stored): void {
  countGroupsStore.setState({ groups: next.groups, current: next.current });
  try {
    localStorage.setItem(
      COUNT_GROUPS_STORAGE_KEY,
      JSON.stringify({ groups: next.groups, current: next.current }),
    );
  } catch {
    // Not kept (private window): the groups hold until the app closes.
  }
}

/** Clear all local data: no groups made, the first one used again. */
export function resetCountGroups(): void {
  countGroupsStore.setState({ groups: [], current: '' });
  try {
    localStorage.removeItem(COUNT_GROUPS_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/** A count of the document, as read now (with its file data when it came from the file). */
export interface PlacedCount {
  annotation: PdfAnnotationObject;
  meta: MeasureMeta;
}

/** Every count of a document (all pages, or one), from the annotation plugin's state. */
export function countsOf(docId: string, page?: number): PlacedCount[] {
  const scope = annotationCapability()?.forDocument(docId);
  if (!scope) return [];
  const out: PlacedCount[] = [];
  for (const ta of scope.getAnnotations()) {
    const o = ta.object;
    if (o.type !== PdfAnnotationSubtype.STAMP) continue;
    if (page !== undefined && o.pageIndex !== page) continue;
    const a = withFileMeta(docId, o);
    const meta = metaOf(a) ?? metaFor(docId, a);
    if (meta?.tool === 'count') out.push({ annotation: a, meta });
  }
  return out;
}

/** A placed count's group as it draws. */
function groupOfCount(c: PlacedCount): CountGroup | null {
  const o = c.annotation as unknown as { strokeColor?: unknown };
  return groupOf({
    name: c.meta.group ?? '',
    shape: c.meta.sym ?? 'circle',
    color: typeof o.strokeColor === 'string' ? o.strokeColor.toLowerCase() : '',
    size: c.meta.size ?? DEFAULT_COUNT_SIZE,
  });
}

/**
 * The groups to choose from: the document's own (as its counts draw), then the
 * ones made on this device, then the first one anyone gets when there are none.
 */
export function groupsFor(docId: string | null, counts?: readonly PlacedCount[]): CountGroup[] {
  const out: CountGroup[] = [];
  const add = (g: CountGroup | null): void => {
    if (g && !out.some((x) => sameGroupName(x.name, g.name))) out.push(g);
  };
  for (const c of counts ?? (docId ? countsOf(docId) : [])) add(groupOfCount(c));
  for (const g of countGroupsStore.getState().groups) add(g);
  if (out.length === 0) add(defaultGroup());
  return out;
}

/** The group the next click uses: the last one used, else the first there is. */
export function currentGroup(docId: string | null, counts?: readonly PlacedCount[]): CountGroup {
  const all = groupsFor(docId, counts);
  const name = countGroupsStore.getState().current;
  return all.find((g) => sameGroupName(g.name, name)) ?? all[0] ?? defaultGroup();
}

/** Keeps `g` among the device's groups (replacing one of the same name, or `was`). */
function remember(g: CountGroup, was?: string): void {
  const s = countGroupsStore.getState();
  const groups = s.groups.filter(
    (x) => !sameGroupName(x.name, g.name) && !(was !== undefined && sameGroupName(x.name, was)),
  );
  save({ groups: [...groups, g], current: g.name });
}

/** The group picked in the Count group box (Q14): it is used from the next click. */
export function selectGroup(docId: string | null, name: string): void {
  const g = groupsFor(docId).find((x) => sameGroupName(x.name, name));
  if (g) remember(g);
}

/** "Group 2", "Group 3" …: a name no group has. */
function freshName(taken: readonly CountGroup[]): string {
  for (let i = taken.length + 1; ; i++) {
    const name = cleanGroupName(t('measure.count.newGroupName', { n: String(i) }));
    if (!taken.some((g) => sameGroupName(g.name, name))) return name;
  }
}

/** New group: the next shape and colour, the size of the current one; used from the next click. */
export function newGroup(docId: string | null): CountGroup {
  const all = groupsFor(docId);
  const g: CountGroup = {
    name: freshName(all),
    shape: COUNT_SHAPES[all.length % COUNT_SHAPES.length] ?? 'circle',
    color: GROUP_COLORS[all.length % GROUP_COLORS.length] ?? '#ff0000',
    size: currentGroup(docId).size,
  };
  remember(g);
  return g;
}

/** The number the next count of `group` takes in the document (Q15). */
export function nextCountNumber(
  docId: string,
  group: string,
  counts?: readonly PlacedCount[],
): number {
  return nextNumber(
    (counts ?? countsOf(docId))
      .filter((c) => sameGroupName(c.meta.group ?? '', group))
      .map((c) => c.meta.n ?? 0),
  );
}

export type GroupChange = Partial<Omit<CountGroup, 'name'>> & { name?: string };

/** Why a group change was refused, if it was. */
export type GroupRefusal = 'empty' | 'taken' | null;

/**
 * Changes a group (the Count group box): kept on this device, and every count
 * of it in the document follows in one undo step (its symbol, colour, size,
 * and its text when the name changes).
 */
export function editGroup(docId: string | null, name: string, change: GroupChange): GroupRefusal {
  const counts = docId ? countsOf(docId) : [];
  const all = groupsFor(docId, counts);
  const was = all.find((g) => sameGroupName(g.name, name));
  if (!was) return null;
  const nextName = change.name === undefined ? was.name : cleanGroupName(change.name);
  if (!nextName) return 'empty';
  if (!sameGroupName(nextName, was.name) && all.some((g) => sameGroupName(g.name, nextName)))
    return 'taken';
  const next = groupOf({ ...was, ...change, name: nextName });
  if (!next) return null;
  remember(next, was.name);
  if (!docId) return null;
  const scope = annotationCapability()?.forDocument(docId);
  if (!scope) return null;
  const mine = counts.filter((c) => sameGroupName(c.meta.group ?? '', was.name));
  const updates = mine.flatMap((c) => {
    const meta: MeasureMeta = {
      ...c.meta,
      group: next.name,
      sym: next.shape,
      size: next.size,
    };
    const o = c.annotation as unknown as { strokeColor?: string };
    const same =
      meta.group === c.meta.group &&
      meta.sym === c.meta.sym &&
      meta.size === c.meta.size &&
      (o.strokeColor ?? '').toLowerCase() === next.color;
    return same
      ? []
      : [
          {
            a: c.annotation,
            patch: { measure: meta, strokeColor: next.color } as Partial<PdfAnnotationObject>,
          },
        ];
  });
  applyAll(docId, updates);
  return null;
}

/** Several annotation changes as one undo step (the first is the step, the rest join it). */
function applyAll(
  docId: string,
  updates: readonly { a: PdfAnnotationObject; patch: Partial<PdfAnnotationObject> }[],
): void {
  const scope = annotationCapability()?.forDocument(docId);
  const [first, ...rest] = updates;
  if (!scope || !first) return;
  scope.updateAnnotation(first.a.pageIndex, first.a.id, first.patch);
  if (rest.length)
    joinStep(() => {
      for (const u of rest) scope.updateAnnotation(u.a.pageIndex, u.a.id, u.patch);
    });
}

/** The group's counts as Renumber sees them. */
function counted(list: readonly PlacedCount[]) {
  return list.map((c) => ({
    id: c.annotation.id,
    n: c.meta.n ?? 0,
    page: c.annotation.pageIndex,
    at: measurePoints(c.annotation)[0] ?? c.annotation.rect.origin,
  }));
}

/** Whether Renumber group would change anything (its numbers have gaps). */
export function groupHasGaps(
  docId: string,
  group: string,
  counts?: readonly PlacedCount[],
): boolean {
  const mine = (counts ?? countsOf(docId)).filter((c) => sameGroupName(c.meta.group ?? '', group));
  return renumber(counted(mine)).length > 0;
}

/** Renumber group (Q15): its counts 1, 2, 3 … with no gaps, in one undo step. Returns how many changed. */
export function renumberGroup(docId: string, group: string): number {
  const mine = countsOf(docId).filter((c) => sameGroupName(c.meta.group ?? '', group));
  const byId = new Map(mine.map((c) => [c.annotation.id, c]));
  const plan = renumber(counted(mine));
  applyAll(
    docId,
    plan.flatMap(({ id, n }) => {
      const c = byId.get(id);
      return c
        ? [
            {
              a: c.annotation,
              patch: { measure: { ...c.meta, n } } as Partial<PdfAnnotationObject>,
            },
          ]
        : [];
    }),
  );
  return plan.length;
}

/**
 * A selected count moved to another group (the Properties pane): it takes that
 * group's look and the next number in it.
 */
export function moveToGroup(docId: string, id: string, name: string): void {
  const counts = countsOf(docId);
  const c = counts.find((x) => x.annotation.id === id);
  const g = groupsFor(docId, counts).find((x) => sameGroupName(x.name, name));
  if (!c || !g || sameGroupName(c.meta.group ?? '', g.name)) return;
  const n = nextCountNumber(docId, g.name, counts);
  applyAll(docId, [
    {
      a: c.annotation,
      patch: {
        measure: { ...c.meta, group: g.name, sym: g.shape, size: g.size, n },
        strokeColor: g.color,
      } as Partial<PdfAnnotationObject>,
    },
  ]);
}
