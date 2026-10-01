// Table templates in memory (M4-15, §7.7, M4-Q9): loaded from IndexedDB once
// (§10.3), saved, renamed and deleted there; "Clear all local data" removes
// them. Applying one gives grids for pages of the same size and rotation (the
// others are skipped and named). Nothing here is logged (rule 10).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import type { TableGrid } from '../../model/tableGrid';
import {
  applyTemplate,
  parseTemplate,
  templateFromGrid,
  type PageFrame,
  type TableTemplate,
} from '../../model/tableTemplate';
import { appDb } from '../../storage/appDb';
import { hostStore } from '../view/host';

interface TemplatesState {
  templates: TableTemplate[];
  loaded: boolean;
  /** The Table Templates dialog is open for this document. */
  dialogDoc: string | null;
}

export const templateStore = createStore<TemplatesState>()(() => ({
  templates: [],
  loaded: false,
  dialogDoc: null,
}));

export function useTemplates<T>(selector: (s: TemplatesState) => T): T {
  return useStore(templateStore, selector);
}

/** A page's size, crop origin and rotation as the viewer has it. */
export function pageFrame(docId: string, page: number): PageFrame {
  const registry = hostStore.getState().registry;
  const p = registry?.getStore().getState().core.documents[docId]?.document?.pages[page];
  const crop = p?.boxes?.crop;
  return {
    width: p?.size.width ?? 612,
    height: p?.size.height ?? 792,
    originX: crop?.left ?? 0,
    originY: crop?.bottom ?? 0,
    rotation: (p?.rotation ?? 0) * 90,
  };
}

let loading: Promise<void> | null = null;

export function loadTemplates(): Promise<void> {
  loading ??= appDb()
    .then(async (db) => {
      const stored = await db.listTableTemplates();
      // Only well-formed templates come back (a damaged record is skipped).
      const templates = stored
        .map(parseTemplate)
        .filter((x): x is TableTemplate => x !== null)
        .sort((a, b) => a.created - b.created);
      templateStore.setState({ templates, loaded: true });
    })
    .catch((err: unknown) => {
      recordError('tableTemplates.load', err);
      templateStore.setState({ loaded: true });
    });
  return loading;
}

async function persist(
  job: (db: Awaited<ReturnType<typeof appDb>>) => Promise<void>,
): Promise<boolean> {
  try {
    await job(await appDb());
    return true;
  } catch (err) {
    recordError('tableTemplates.save', err);
    return false;
  }
}

/** Saves `grid` (on its page of `docId`) as a new template. */
export async function saveTemplate(
  docId: string,
  grid: TableGrid,
  name: string,
): Promise<TableTemplate | null> {
  await loadTemplates();
  const t = templateFromGrid(
    grid,
    pageFrame(docId, grid.page),
    name,
    crypto.randomUUID(),
    Date.now(),
  );
  if (!t.name) return null;
  templateStore.setState((s) => ({ templates: [...s.templates, t] }));
  return (await persist((db) => db.putTableTemplate(t))) ? t : null;
}

export function renameTemplate(id: string, name: string): Promise<boolean> {
  const t = templateStore.getState().templates.find((x) => x.id === id);
  const trimmed = name.trim();
  if (!t || !trimmed) return Promise.resolve(false);
  const next = { ...t, name: trimmed.slice(0, 80) };
  templateStore.setState((s) => ({
    templates: s.templates.map((x) => (x.id === id ? next : x)),
  }));
  return persist((db) => db.putTableTemplate(next));
}

export function deleteTemplate(id: string): Promise<boolean> {
  templateStore.setState((s) => ({ templates: s.templates.filter((x) => x.id !== id) }));
  return persist((db) => db.deleteTableTemplate(id));
}

/** The template's grids on `pages` of `docId`, and the pages it doesn't fit. */
export function templateGrids(
  docId: string,
  id: string,
  pages: readonly number[],
): { grids: TableGrid[]; skipped: number[] } {
  const t = templateStore.getState().templates.find((x) => x.id === id);
  if (!t) return { grids: [], skipped: [...pages] };
  return applyTemplate(t, pages, (p) => pageFrame(docId, p));
}

export function openTemplates(docId: string): void {
  void loadTemplates();
  templateStore.setState({ dialogDoc: docId });
}

export function closeTemplates(): void {
  templateStore.setState({ dialogDoc: null });
}

/** "Clear all local data": no templates. */
export function resetTemplates(): void {
  loading = null;
  templateStore.setState({ templates: [], loaded: true });
}
