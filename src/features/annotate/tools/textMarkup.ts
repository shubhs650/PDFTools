// The text markup tools (M3-08, §7.1, D-03): Highlight, Underline, Strikeout,
// Squiggly, Insert Text and Replace Text. Two ways in, one code path:
// - text already selected (drag with Select, or Ctrl+A from the keyboard,
//   M3-Q6) and the command run → the markup is made from that selection;
// - otherwise the command turns the tool on (until Esc or the command again)
//   and each text selection made with it becomes a markup — EmbedPDF calls
//   our selection handler (plugins.ts) instead of its own.
// The reviewer profile comes first (M3-07). The selected text goes to
// /Contents only when the document allows copying (rule 9); nothing goes to
// EmbedPDF's private EPDFCustom key (rule 6, the Render worker drops it too).
import { PdfAnnotationSubtype, uuidV4, type PdfAnnotationObject } from '@embedpdf/models';
import type { SelectionHandlerFactory } from '@embedpdf/plugin-annotation';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { allows } from '../../../model/permissions';
import { requestProfile } from '../../settings/profile/profileStore';
import { capability, hostStore } from '../../view/host';
import { annotationCapability } from '../selection';
import { openContentsPrompt } from './contentsPrompt';
import { buildMarkups, textsPerPage, type MarkupTool, type PageSelection } from './markupModel';
import { isStyleTool } from './toolDefaults';
import { defaultsFor } from './toolDefaultsStore';

/**
 * A markup tool's current style (its palette: the highlight since M6-07,
 * underline, strikeout and squiggly since M6-17); insert and replace text keep theirs.
 */
function styleOf(tool: MarkupTool): { color: string; opacity: number } | undefined {
  if (!isStyleTool(tool)) return undefined;
  const d = defaultsFor(tool);
  const color = d.strokeColor ?? d.color;
  return color ? { color, opacity: d.opacity ?? 1 } : undefined;
}

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

/** The selected text per page, started now (the selection is cleared right after). */
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

async function make(
  docId: string,
  tool: MarkupTool,
  selections: readonly PageSelection[],
  text: Promise<string[] | undefined>,
): Promise<PdfAnnotationObject[]> {
  if (selections.length === 0) return [];
  await requestProfile();
  const made = buildMarkups(tool, selections, {
    now: new Date(),
    newId: uuidV4,
    texts: textsPerPage(selections, await text),
    style: styleOf(tool),
  });
  const scope = annotationCapability()?.forDocument(docId);
  if (!scope) return [];
  for (const a of made) scope.createAnnotation(a.pageIndex, a);
  const first = made[0];
  if (first) {
    scope.selectAnnotation(first.pageIndex, first.id);
    // Inserted or replacing text is typed next; it goes to the caret's /Contents.
    if (first.type === PdfAnnotationSubtype.CARET)
      openContentsPrompt('caret', docId, first.pageIndex, first.id);
  }
  return made;
}

/** The current text selection of `docId` becomes `tool`'s markup; false when nothing is selected. */
export function markupFromSelection(docId: string, tool: MarkupTool): boolean {
  const sel = selection()?.forDocument(docId);
  const selections = sel?.getFormattedSelection() ?? [];
  if (!sel || selections.length === 0) return false;
  const text = selectedText(docId);
  sel.clear();
  void make(docId, tool, selections, text);
  return true;
}

/** Replaces EmbedPDF's selection handler for a markup tool (plugins.ts). */
export function markupSelectionHandler(tool: MarkupTool): SelectionHandlerFactory {
  return {
    toolId: tool,
    handle(context, selections) {
      // Runs before the plugin clears the selection: start reading its text now.
      void make(context.documentId, tool, selections, selectedText(context.documentId));
    },
  };
}
