import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { valueText } from '../../model/measurement';
import { useDocuments } from '../../app/store/documentStore';
import { useMeasure } from './measureStore';
import { scaleOf, useScales } from './scaleStore';

/**
 * The value of the measurement being drawn, next to the pointer (M3-16,
 * §7.4): plain arithmetic on the plugin's preview points in the page's
 * scale, no PDF work (rule 1). Drawing is pointer-only (M3-Q6), so this is
 * hidden from assistive tech; the finished value is the annotation's text.
 */
export function MeasureOverlay({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const active = useDocuments((s) => s.activeId === documentId);
  const live = useMeasure((s) => (active && s.live?.page === pageIndex ? s.live : null));
  const entry = useScales((s) => s.docs[documentId]);
  const text = useMemo(() => {
    if (!live || live.pts.length < 2) return null;
    const s = entry ? scaleOf({ docs: { [documentId]: entry } }, documentId, pageIndex) : null;
    const v = valueText(live.kind, live.pts, s, format);
    return v.calibrated ? v.value : t('measure.uncalibrated', { value: v.value });
  }, [live, entry, documentId, pageIndex, t]);
  const at = live?.pts[live.pts.length - 1];
  if (!text || !at) return null;
  return (
    <div className="measure-overlay" aria-hidden="true">
      <span
        className="measure-live"
        data-testid="measure-live"
        style={{ left: at.x * scale, top: at.y * scale }}
      >
        {text}
      </span>
    </div>
  );
}
