// What the commands may do in a comparison's windows (M12-12, D-62). Each
// window shows one sheet: the page of its document that the sheet pairs, so
// page turns, view modes, the view rotation and page changes stay out (the
// sheet list moves between sheets, and a page change would undo the
// pairing). The overlay window's notes are the comparison's own (D-62): they
// take the comment, edit and view commands, never a file, page or security
// command, so nothing drawn there is saved, printed or turned into a document.
import { documentStore } from '../../../app/store/documentStore';
import { msg, type MessageKey } from '../../../i18n';

/** Kept out of every comparison window: the window shows one sheet. */
const ONE_SHEET = new Set([
  'view.firstPage',
  'view.prevPage',
  'view.nextPage',
  'view.lastPage',
  'view.prevView',
  'view.nextView',
  'view.singlePage',
  'view.continuous',
  'view.facing',
  'view.continuousFacing',
  'view.rotateCw',
  'view.rotateCcw',
]);

/** Command families that change pages: not in a comparison window (they would undo the pairing). */
const PAGES = ['organize.'];

/**
 * Kept off the notes (D-62): saving, printing and the document's properties,
 * pages, conversion, security, forms and bookmarks. Comments, editing, the view
 * and measuring work; commands that need no document (Open, Settings, Help) too.
 */
const NOT_ON_NOTES = new Set([
  'file.save',
  'file.saveAs',
  'file.saveOptimized',
  'file.print',
  'file.exportPrintReady',
  'file.properties',
  'qat.save',
  'qat.print',
  'home.resetForm',
]);
const NOT_ON_NOTES_FAMILIES = ['organize.', 'convert.', 'protect.', 'form.', 'bookmark.'];

const startsWith = (id: string, families: readonly string[]): boolean =>
  families.some((f) => id.startsWith(f));

/** The reason `id` can't run in the comparison window in use, or null. */
export function compareGuard(id: string): MessageKey | null {
  const s = documentStore.getState();
  if (!s.activeTab || !s.comparisons[s.activeTab]) return null;
  const active = s.activeId ? s.docs[s.activeId] : undefined;
  if (!active) return null;
  if (ONE_SHEET.has(id)) return msg('compare.review.oneSheet');
  if (active.meta.role === 'notes') {
    if (NOT_ON_NOTES.has(id) || startsWith(id, NOT_ON_NOTES_FAMILIES))
      return msg('compare.review.notOnNotes');
    return null;
  }
  if (startsWith(id, PAGES)) return msg('compare.review.pagesInTab');
  return null;
}
