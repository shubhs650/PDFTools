import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { leaderOf } from '../../model/dimension';
import { isCurveTool } from '../../model/measureCurve';
import {
  isCurveKind,
  labelAnchor,
  measurePoints,
  measuredValue,
  toUserSpace,
  valueText,
} from '../../model/measurement';
import { liveScale, scaleOfChoice } from '../../model/scaleViewport';
import { useAnnotationMap } from '../annotate/comments/commentsStore';
import { CurveShapeSvg } from './CurveShape';
import { choiceFor, curveWords, kindOf } from './measurements';
import { useDocuments } from '../../app/store/documentStore';
import { useMeasure } from './measureStore';
import { layoutFor, useScales } from './scaleStore';
import { frameOf } from './viewports';

const CURRENT = 'currentColor';

/** Its test id (not shown). */
const LIVE_ID = 'measure-curve-live';

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
  // The value in the scale of the area it started in; a warning instead as soon as
  // a point is in another scale area (M14-02, D-77, Q30).
  const live2 = useMemo(() => {
    if (!live || live.pts.length < 2) return null;
    // An Angle or a curve by three points has no value until its last point.
    if (isCurveKind(live.kind) && !Number.isFinite(measuredValue(live.kind, live.pts, null)))
      return null;
    // An Angle needs no scale (Q9), so where it is drawn does not matter.
    if (live.kind === 'angle') {
      const v = valueText('angle', live.pts, null, format, curveWords);
      return { text: v.value, warning: false };
    }
    const layout = entry
      ? layoutFor({ docs: { [documentId]: entry } }, documentId, pageIndex)
      : { pageDefault: null, details: [] };
    const where = liveScale(toUserSpace(live.pts, frameOf(documentId, pageIndex)), layout);
    if (where.kind === 'crosses')
      return { text: t('measure.live.crosses', { name: where.name }), warning: true };
    if (where.kind === 'leaves')
      return { text: t('measure.live.leaves', { name: where.name }), warning: true };
    const v = valueText(live.kind, live.pts, scaleOfChoice(where.choice), format, curveWords);
    return {
      text: v.calibrated ? v.value : t('measure.uncalibrated', { value: v.value }),
      warning: false,
    };
  }, [live, entry, documentId, pageIndex, t]);
  const text = live2?.text ?? null;
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
        return { id: o.id, at: labelAnchor(k, measurePoints(o), leaderOf(o)) };
      });
    // entry: viewports changed → re-evaluate.
  }, [byUid, hasDetails, documentId, pageIndex, entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = live?.at ?? live?.pts[live.pts.length - 1];
  const curve = live && isCurveTool(live.kind) ? live.kind : null;
  if ((!text || !at) && spans.length === 0 && !curve) return null;
  return (
    <div className="measure-overlay" aria-hidden="true">
      {live && curve ? (
        <CurveShapeSvg
          tool={curve}
          pts={live.pts}
          color={live.color ?? CURRENT}
          width={live.width ?? 1}
          scale={scale}
          data-testid={LIVE_ID}
        />
      ) : null}
      {live?.leaders ? (
        // A Distance's leader lines while its offset is set (M13-10); the plugin
        // previews the dimension line itself.
        <svg className="measure-leaders" data-testid="measure-leaders">
          {live.leaders.map(([p, q], i) => (
            <line
              key={i}
              x1={p.x * scale}
              y1={p.y * scale}
              x2={q.x * scale}
              y2={q.y * scale}
              stroke={live.color ?? 'currentColor'}
              strokeWidth={Math.max(1, (live.width ?? 1) * scale)}
            />
          ))}
        </svg>
      ) : null}
      {text && at ? (
        <span
          className={live2?.warning ? 'measure-live measure-live--warning' : 'measure-live'}
          data-testid="measure-live"
          data-warning={live2?.warning ? true : undefined}
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
