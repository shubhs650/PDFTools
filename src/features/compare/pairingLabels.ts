// How the pairing table, the page picker and Preview pair name a side's pages
// (M12-09, M12-24): "Page 3", or "Sheets-B.pdf, page 2" when the side is a set
// of several files.
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import type { PairingState } from './pairingFlow';
import type { SideId } from './model';

export type PageLabel = (side: SideId, k: number) => string;

export function pageLabeler(
  p: PairingState | undefined,
  nameOf: (docId: string) => string,
  t: TFunction,
): PageLabel {
  const sets: Record<SideId, boolean> = {
    a: new Set(p?.pages.a.map((x) => x.docId)).size > 1,
    b: new Set(p?.pages.b.map((x) => x.docId)).size > 1,
  };
  return (side, k) => {
    const page = p?.pages[side][k];
    if (!page) return '';
    const n = format.number(page.page + 1);
    return sets[side]
      ? t('compare.pairing.pageOf', { name: nameOf(page.docId), page: n })
      : t('compare.pairing.page', { page: n });
  };
}

/** The page labels of a pairing, following file names. */
export function usePageLabel(p: PairingState | undefined): PageLabel {
  const { t } = useTranslation();
  const docs = useDocuments((s) => s.docs);
  return pageLabeler(p, (d) => docs[d]?.meta.name ?? '', t);
}
