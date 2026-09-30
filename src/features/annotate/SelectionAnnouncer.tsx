// Screen-reader announcement of the annotation selection (M3-05, rule 12):
// the plugin's handles have no accessible name, so the selected annotation is
// named here (type, author, page) in a polite live region.
import type { PdfAnnotationObject } from '@embedpdf/models';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHost } from '../view/host';
import { annotationTypeKey } from './annotationTypes';
import { annotationCapability } from './selection';
import { useTransferAnnouncement } from './transfer/transferAnnounce';

export function SelectionAnnouncer({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const registry = useHost((s) => s.registry);
  const [selected, setSelected] = useState<PdfAnnotationObject[]>([]);
  // A comment import, copy or paste (M4-20, M4-21) is said first.
  const transfer = useTransferAnnouncement(documentId);
  useEffect(() => {
    if (!registry) return;
    let scope;
    try {
      scope = annotationCapability()?.forDocument(documentId);
    } catch {
      return;
    }
    if (!scope) return;
    const s = scope;
    return s.onStateChange((st) => {
      const next = st.selectedUids
        .map((uid) => st.byUid[uid]?.object)
        .filter((o): o is PdfAnnotationObject => o !== undefined);
      setSelected((prev) =>
        prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next,
      );
    });
  }, [registry, documentId]);

  let text = '';
  const [one] = selected;
  if (selected.length === 1 && one)
    text = t('annotate.selectedOne', {
      type: t(annotationTypeKey(one)),
      author: one.author ?? t('annotate.noAuthor'),
      page: one.pageIndex + 1,
    });
  else if (selected.length > 1) text = t('annotate.selectedMany', { count: selected.length });
  if (transfer) text = transfer;
  return (
    <div className="ui-visually-hidden" role="status" aria-live="polite">
      {text}
    </div>
  );
}
