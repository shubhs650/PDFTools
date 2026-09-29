import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { labelAnchor, measurePoints, valueText } from '../../model/measurement';
import { useAnnotationMap } from '../annotate/comments/commentsStore';
import { choiceFor, kindOf } from './measurements';
import { useDocuments } from '../../app/store/documentStore';
import { useMeasure } from './measureStore';
import { layoutFor, scaleOf, useScales } from './scaleStore';

/**
 * The value of the measurement being drawn, next to the pointer (M3-16,
 * §7.4): plain arithmetic on the plugin's preview points in the page's
 * scale, no PDF work (rule 1). Drawing is pointer-only (M3-Q6), so this is
 * hidden from assistive tech; the finished value is the annotation's text.
 * Also flags measurements that span scale viewports (M3-17; the Properties
 * pane says the same in words).
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
  // Spanning flags only where the page has detail viewports.
  const hasDetails = useMemo(
    () =>
      !!entry &&
      layoutFor({ docs: { [documentId]: entry } }, documentId, pageIndex).details.length > 0,
    [entry, documentId, pageIndex],
  );
  const byUid = useAnnotationMap(hasDetails ? documentId : null);
  const spans = useMemo(() => {
    if (!byUid || !hasDetails) return [];
    return Object.values(byUid)
      .map((x) => x.object)
      .filter(
        (o) =>
          o.pageIndex === pageIndex &&
          kindOf(documentId, o) &&
          choiceFor(documentId, o).kind === 'spanning',
      )
      .map((o) => {
        const k = kindOf(documentId, o) ?? 'distance';
        return { id: o.id, at: labelAnchor(k, measurePoints(o)) };
      });
    // entry: viewports changed → re-evaluate.
  }, [byUid, hasDetails, documentId, pageIndex, entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = live?.pts[live.pts.length - 1];
  if ((!text || !at) && spans.length === 0) return null;
  return (
    <div className="measure-overlay" aria-hidden="true">
      {text && at ? (
        <span
          className="measure-live"
          data-testid="measure-live"
          style={{ left: at.x * scale, top: at.y * scale }}
        >
          {text}
        </span>
      ) : null}
      {spans.map((sp) => (
        <span
          key={sp.id}
          className="measure-spans"
          data-testid="measure-spans"
          style={{ left: sp.at.x * scale, top: sp.at.y * scale }}
        >
          {t('measure.spansBadge')}
        </span>
      ))}
    </div>
  );
}
