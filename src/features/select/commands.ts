// Text selection keys (M2-04, M1-Q5, §8.1): Ctrl+C copies the selected text,
// Ctrl+A selects the current page's text, Esc clears the selection. Selecting
// with the pointer is the selection plugin's (Select tool, V). Copying is
// refused when the document forbids it (rule 9).
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { capability, hostStore, renderEngine } from '../view/host';

function selection(): SelectionCapability | null {
  const registry = hostStore.getState().registry;
  return registry ? capability<SelectionCapability>(registry, 'selection') : null;
}

import {
  copyRoute,
  copySelectedComments,
  pasteBlocked,
  pasteComments,
  selectedCount,
} from '../annotate/transfer/copyPaste';

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

/** Selects all text on the active document's current page. */
export async function selectPageText(): Promise<void> {
  const sel = selection();
  const registry = hostStore.getState().registry;
  const id = activeId();
  if (!sel || !registry || !id) return;
  const doc = registry.getStore().getState().core.documents[id]?.document;
  const pageIndex = documentStore.getState().docs[id]?.view.page ?? 0;
  const page = doc?.pages[pageIndex];
  if (!doc || !page) return;
  const geometry = await renderEngine().engine.getPageGeometry(doc, page).toPromise();
  const last = geometry.runs.at(-1);
  if (!last || last.glyphs.length === 0) return;
  await sel
    .forDocument(id)
    .setSelection({
      start: { page: pageIndex, index: geometry.runs[0]?.charStart ?? 0 },
      end: { page: pageIndex, index: last.charStart + last.glyphs.length - 1 },
    })
    .toPromise();
}

export function clearSelection(): void {
  const id = activeId();
  if (id) selection()?.forDocument(id).clear();
}

export function registerSelectionCommands(): () => void {
  const offs = [
    // Ctrl+C (M4-21): selected comments go to the in-app clipboard; text otherwise.
    registerCommand('edit.copy', {
      requires: 'copy',
      run: async () => {
        const id = activeId();
        if (!id) return;
        const text = selection()?.forDocument(id).getFormattedSelection().length ?? 0;
        if (copyRoute({ comments: selectedCount(id), text: text > 0 }) === 'comments')
          await copySelectedComments(id);
        else selection()?.forDocument(id).copyToClipboard();
      },
    }),
    // Ctrl+V (M4-21): the copied comments onto the current page; the browser keeps it otherwise.
    registerCommand('edit.paste', {
      disabledReason: () => pasteBlocked(activeId()),
      run: async () => {
        const id = activeId();
        if (id) await pasteComments(id, 'current');
      },
    }),
    registerCommand('edit.selectAll', {
      requiresDocument: true,
      run: selectPageText,
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
