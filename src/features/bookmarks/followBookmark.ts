// Following a bookmark (M2-10): its page, or a short notice when it has none, so a
// bookmark whose page was deleted is never a silent dead click (pre-release audit bug 10).
import type { PdfLinkTarget } from '@embedpdf/models';
import { documentStore } from '../../app/store/documentStore';
import { t } from '../../i18n';
import { showStatusToast } from '../snapshot/snapshot';
import { followTarget } from '../view/links';

export function followBookmark(target: PdfLinkTarget | undefined): void {
  if (followTarget(target) !== 'missing') return;
  const docId = documentStore.getState().activeId;
  if (docId) showStatusToast(docId, t('bookmarks.noDestination'), false);
}
