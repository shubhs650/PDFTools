// Marking for redaction (M4-16, §7.9 step 1): Protect → Mark for Redaction
// turns a text selection into /Redact marks (the selection already made — a
// drag or Ctrl+A — or each selection made while the tool is on, as the text
// markup tools, M3-08), and Mark Area for Redaction draws rectangles with the
// pointer or, from the keyboard, a rectangle at the page's centre (M4-Q10:
// arrows move, Shift+arrows resize, Enter marks). Marks are created through the
// annotation plugin, so they are undoable and saved with Ctrl+S like any
// markup (M4-Q3). The selected text goes to /Contents only when copying is
// allowed (rule 9).
import { uuidV4, type PdfAnnotationObject, type Rect } from '@embedpdf/models';
import type { SelectionHandlerFactory } from '@embedpdf/plugin-annotation';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { createStore, useStore } from 'zustand';
import { documentStore, securityOf } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { textsPerPage, type PageSelection } from '../annotate/tools/markupModel';
import { annotationCapability } from '../annotate/selection';
import { capability, hostStore } from '../view/host';
import { areaMark, MIN_AREA, textMarks } from './markModel';

export const REDACT_TEXT_TOOL = 'redactText';

function selection(): SelectionCapability | null {
  const registry = hostStore.getState().registry;
  try {
    return registry ? capability<SelectionCapability>(registry, 'selection') : null;
  } catch {
    return null;
  }
}

const mayCopy = (docId: string): boolean => {
  const meta = documentStore.getState().docs[docId]?.meta;
  return meta ? allows(securityOf(meta), 'copy') : false;
};

function selectedText(docId: string): Promise<string[] | undefined> {
  if (!mayCopy(docId)) return Promise.resolve(undefined);
  const task = selection()?.forDocument(docId).getSelectedText();
  if (!task) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    task.wait(resolve, () => {
      resolve(undefined);
    });
  });
}

function create(docId: string, marks: readonly PdfAnnotationObject[]): void {
  const scope = annotationCapability()?.forDocument(docId);
  if (!scope) return;
  for (const m of marks) scope.createAnnotation(m.pageIndex, m);
}

async function markText(
  docId: string,
  selections: readonly PageSelection[],
  text: Promise<string[] | undefined>,
): Promise<number> {
  const marks = textMarks(selections, {
    now: new Date(),
    newId: uuidV4,
    texts: textsPerPage(selections, await text),
  });
  create(docId, marks);
  return marks.length;
}

/** The current text selection becomes redaction marks; false when nothing is selected. */
export function markSelection(docId: string): boolean {
  const sel = selection()?.forDocument(docId);
  const selections = sel?.getFormattedSelection() ?? [];
  if (!sel || selections.length === 0) return false;
  const text = selectedText(docId);
  sel.clear();
  void markText(docId, selections, text);
  return true;
}

/** EmbedPDF calls this for each text selection made with the Mark for Redaction tool. */
export const redactSelectionHandler: SelectionHandlerFactory = {
  toolId: REDACT_TEXT_TOOL,
  handle(context, selections) {
    void markText(context.documentId, selections, selectedText(context.documentId));
  },
};

/** The page's unrotated size in points, as EmbedPDF has it. */
export function pageSize(docId: string, page: number): { width: number; height: number } {
  const registry = hostStore.getState().registry;
  const p = registry?.getStore().getState().core.documents[docId]?.document?.pages[page];
  return { width: p?.size.width ?? 612, height: p?.size.height ?? 792 };
}

/** An area mark on `page` (EmbedPDF points); false when too small. */
export function markArea(docId: string, page: number, rect: Rect): boolean {
  const m = areaMark(page, rect, pageSize(docId, page), { now: new Date(), newId: uuidV4 });
  if (!m) return false;
  create(docId, [m]);
  return true;
}

// ---- the keyboard rectangle (M4-Q10) ------------------------------------------------

interface KeyRectState {
  docId: string | null;
  page: number;
  rect: Rect | null;
}

export const keyRectStore = createStore<KeyRectState>()(() => ({
  docId: null,
  page: 0,
  rect: null,
}));

export function useKeyRect<T>(selector: (s: KeyRectState) => T): T {
  return useStore(keyRectStore, selector);
}

/** A rectangle at the centre of `page`, a quarter of its width, to move and size with the keys. */
export function startKeyRect(docId: string, page: number): void {
  const { width, height } = pageSize(docId, page);
  const w = Math.max(MIN_AREA * 4, width / 4);
  const h = Math.max(MIN_AREA * 2, height / 16);
  keyRectStore.setState({
    docId,
    page,
    rect: { origin: { x: (width - w) / 2, y: (height - h) / 2 }, size: { width: w, height: h } },
  });
}

/** Moves (or with `resize`, grows) the rectangle by (dx, dy) points, kept on the page. */
export function nudgeKeyRect(dx: number, dy: number, resize: boolean): void {
  const { docId, page, rect } = keyRectStore.getState();
  if (!docId || !rect) return;
  const { width, height } = pageSize(docId, page);
  const next: Rect = resize
    ? {
        origin: rect.origin,
        size: {
          width: Math.min(width - rect.origin.x, Math.max(MIN_AREA, rect.size.width + dx)),
          height: Math.min(height - rect.origin.y, Math.max(MIN_AREA, rect.size.height + dy)),
        },
      }
    : {
        origin: {
          x: Math.min(width - rect.size.width, Math.max(0, rect.origin.x + dx)),
          y: Math.min(height - rect.size.height, Math.max(0, rect.origin.y + dy)),
        },
        size: rect.size,
      };
  keyRectStore.setState({ rect: next });
}

export function cancelKeyRect(): void {
  keyRectStore.setState({ docId: null, rect: null });
}

/** Marks the keyboard rectangle's area and starts a new one at the same place. */
export function commitKeyRect(): boolean {
  const { docId, page, rect } = keyRectStore.getState();
  if (!docId || !rect) return false;
  return markArea(docId, page, rect);
}
