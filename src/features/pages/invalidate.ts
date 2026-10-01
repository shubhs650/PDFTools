// What follows a page operation on the main thread (M4-09, ADR-016 cache map).
// Everything cached by page index for the document is dropped; panes that
// read per-page data re-read it (they depend on `pagesVersion`). Comment
// numbers are derived from the annotation store and follow by themselves.
import { dropOutline } from '../bookmarks/outlineCache';
import { dropFormCaches } from '../forms/formStore';
import { reloadScales } from '../measure/scaleStore';
import { dropSnapPages } from '../measure/snapping';
import { dropDocument as dropSearchResults } from '../search/searchStore';
import { dropFindResults } from '../search/findStore';
import { clearSelection } from '../select/commands';
import { tileCache } from '../view/host';
import { dropLinks } from '../view/pageLinks';
import { dropPageCosts } from '../view/progressivePreview';

/** The caches and what drops them, in the order they are cleared (for tests and docs). */
export const PAGE_CACHES = [
  'tiles, previews and thumbnails (tileCache)',
  'page render costs (progressive previews)',
  'link annotations per page',
  'bookmark outline (destinations by page)',
  'form widgets per page and form facts',
  'Advanced Search results',
  'Quick Find hits',
  'text selection',
  'page scales and viewports (reloaded)',
  'snap indexes (Snap worker, by document prefix)',
] as const;

export function invalidatePages(docId: string): void {
  tileCache.dropDoc(docId);
  dropPageCosts(docId);
  dropLinks(docId);
  dropOutline(docId);
  dropFormCaches(docId);
  dropSearchResults(docId);
  dropFindResults(docId);
  clearSelection();
  void reloadScales(docId);
  void dropSnapPages(docId);
}
