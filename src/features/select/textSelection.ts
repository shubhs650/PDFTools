// The selected text, for the selected-text menu (M11-08·O1, ADR-028): where it
// is, whether a right click is on it, its text, and Search for "…". The pure
// parts are in selectedText.ts.
import type { FormattedSelection, SelectionCapability } from '@embedpdf/plugin-selection';
import { appStore } from '../../app/store/appStore';
import { documentStore, securityOf } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import {
  requestSearchFocus,
  runAdvancedSearch,
  searchStore,
  setSearchOption,
  setSearchQuery,
} from '../search/searchStore';
import { capability, hostStore } from '../view/host';
import { pagePointAt } from '../view/pagePoint';
import { onSelectedText, searchQueryOf } from './selectedText';

function selection(): SelectionCapability | null {
  const registry = hostStore.getState().registry;
  try {
    return registry ? capability<SelectionCapability>(registry, 'selection') : null;
  } catch {
    return null;
  }
}

/** The document's selected text, one entry per page (empty when none). */
export function textSelectionOf(docId: string): FormattedSelection[] {
  try {
    return selection()?.forDocument(docId).getFormattedSelection() ?? [];
  } catch {
    return []; // the document closed meanwhile
  }
}

/** Whether the screen point is on the document's selected text. */
export function onTextSelectionAt(docId: string, clientX: number, clientY: number): boolean {
  const sel = textSelectionOf(docId);
  if (sel.length === 0) return false;
  const at = pagePointAt(docId, clientX, clientY);
  return at !== null && onSelectedText(at, sel);
}

/**
 * The selected text as a search query, or null when nothing is selected or
 * the document forbids copying (rule 9: its text is not handed out).
 */
export async function selectedQuery(docId: string): Promise<string | null> {
  const meta = documentStore.getState().docs[docId]?.meta;
  if (!meta || !allows(securityOf(meta), 'copy')) return null;
  const task = selection()?.forDocument(docId).getSelectedText();
  if (!task) return null;
  const texts = await new Promise<string[] | null>((resolve) => {
    task.wait(resolve, () => {
      resolve(null);
    });
  });
  const query = texts ? searchQueryOf(texts) : '';
  return query || null;
}

/**
 * Search for "…": the selected text goes into the Search pane and is searched
 * at once (a click runs it, rule 3), literally (regex and wildcards off; the
 * other options and the scope stay as the user left them).
 */
export async function searchSelectedText(docId: string): Promise<void> {
  const query = await selectedQuery(docId);
  if (!query) return;
  const { options } = searchStore.getState();
  if (options.regex) setSearchOption('regex', false);
  if (options.wildcards) setSearchOption('wildcards', false);
  setSearchQuery(query);
  const app = appStore.getState();
  if (!app.leftPaneOpen || app.leftPane !== 'rail.search') app.choosePane('rail.search');
  requestSearchFocus();
  await runAdvancedSearch();
}
