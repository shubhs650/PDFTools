import { useMemo } from 'react';
import { useApp } from '../../app/store/appStore';
import { format } from '../../i18n';
import { ratioLabel } from '../../model/scale';
import { useMeasurePane } from './pane/measureEntries';
import { layoutFor, useScales } from './scaleStore';
import { rectOfBox, useViewports } from './viewports';

/**
 * Scale viewports as labelled outlines (M3-17), while the Measure tab is shown
 * or the viewport tool is on, and the rectangle being drawn. Visual only: the
 * Measurements pane's Scales section lists the same viewports for the keyboard
 * (rule 12, M14-08); the one picked there is drawn as selected, on any tab.
 */
export function ViewportLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const onMeasure = useApp((s) => s.ribbonTab === 'measure' || s.tool === 'scaleViewport');
  const picked = useMeasurePane((s) =>
    s.viewport?.docId === documentId && s.viewport.page === pageIndex ? s.viewport.index : null,
  );
  const shown = onMeasure || picked !== null;
  const entry = useScales((s) => s.docs[documentId]);
  const draft = useViewports((s) => (s.draft?.page === pageIndex ? s.draft : null));
  const boxes = useMemo(() => {
    if (!shown || !entry) return [];
    return layoutFor({ docs: { [documentId]: entry } }, documentId, pageIndex)
      .details.filter((d) => onMeasure || d.index === picked)
      .map((d) => ({
        key: d.index,
        picked: d.index === picked,
        label: `${d.name} ${ratioLabel(d.scale, format)}`,
        r: rectOfBox(documentId, pageIndex, d.bbox),
      }));
  }, [shown, onMeasure, picked, entry, documentId, pageIndex]);
  if (boxes.length === 0 && !draft) return null;
  return (
    <div className="viewport-layer" aria-hidden="true">
      {boxes.map((b) => (
        <div
          key={b.key}
          className={b.picked ? 'viewport-outline viewport-outline--picked' : 'viewport-outline'}
          data-testid="viewport-outline"
          style={{
            left: b.r.left * scale,
            top: b.r.top * scale,
            width: b.r.width * scale,
            height: b.r.height * scale,
          }}
        >
          <span className="viewport-label">{b.label}</span>
        </div>
      ))}
      {draft ? (
        <div
          className="viewport-outline viewport-outline--draft"
          style={{
            left: Math.min(draft.a.x, draft.b.x) * scale,
            top: Math.min(draft.a.y, draft.b.y) * scale,
            width: Math.abs(draft.b.x - draft.a.x) * scale,
            height: Math.abs(draft.b.y - draft.a.y) * scale,
          }}
        />
      ) : null}
    </div>
  );
}
