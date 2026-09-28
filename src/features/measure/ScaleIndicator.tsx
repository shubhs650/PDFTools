import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { ratioLabel } from '../../model/scale';
import { loadScales, scaleOf, useScales } from './scaleStore';
import { UNIT_KEYS } from './units';

/** Status bar: the current page's scale, or "Uncalibrated" (M3-15, §7.4). */
export function ScaleIndicator() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const page = useDocuments((s) => (s.activeId ? (s.docs[s.activeId]?.view.page ?? 0) : 0));
  // The store entry is stable; the scale is derived from it (a new object each time).
  const entry = useScales((s) => (docId ? s.docs[docId] : undefined));
  const scale = useMemo(
    () => (docId && entry ? scaleOf({ docs: { [docId]: entry } }, docId, page) : null),
    [docId, entry, page],
  );
  useEffect(() => {
    if (docId) void loadScales(docId);
  }, [docId]);
  if (!docId) return null;
  return (
    <span className="scale-indicator" data-testid="scale-indicator">
      {scale
        ? t('scale.indicator', {
            ratio: ratioLabel(scale, format),
            unit: t(UNIT_KEYS[scale.ftIn ? 'ftin' : scale.unit]),
          })
        : t('scale.uncalibrated')}
    </span>
  );
}
