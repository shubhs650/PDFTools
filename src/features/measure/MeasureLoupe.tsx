import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { effectiveTool, useApp } from '../../app/store/appStore';
import { useDocuments } from '../../app/store/documentStore';
import { msg, type MessageKey } from '../../i18n';
import { displayedToLaid, laidToDisplayed } from '../../model/compare/align/manual';
import type { SnapKind } from '../../model/snapIndex';
import { renderEngine } from '../view/host';
import { Loupe, type LoupeJob } from '../view/loupe/Loupe';
import { LOUPE_SIDES, loupeShown, type LoupeRegion } from '../view/loupe/loupeModel';
import { useThinLines } from '../view/thinLines';
import { useLoupeSettings } from './loupeSettings';
import { LOUPE_TOOLS, pageFrame, useLoupePointer } from './loupePointer';
import { useSnapping } from './snapping';

/** For the tests: the loupe's own element. */
const LOUPE_TEST_ID = 'measure-loupe';

/** CSS px per point the loupe never goes past (a zoomed-in window needs no more). */
const MAX_ZOOM = 48;

const noop = (): void => undefined;

const KIND_LABEL: Record<SnapKind, MessageKey> = {
  endpoint: msg('snap.kind.endpoint'),
  midpoint: msg('snap.kind.midpoint'),
  intersection: msg('snap.kind.intersection'),
  nearest: msg('snap.kind.nearest'),
};

/**
 * The Measure loupe (M13-02, D-68, ADR-034): with Distance, Perimeter, Area,
 * Calibrate or drawing a Scale Viewport, the spot under the pointer larger
 * (Settings → Measure: size and magnification), with a crosshair at the
 * pointer, the snap marker where the click will land and the snap kind under
 * the lens. The Render worker draws it (the `loupe` request, as a snapshot
 * of the view: content, comments, form fields, the view's turn). Visual
 * only: the snapped point is what the tool uses, and the values are the
 * comments' text. View → Loupe (M13-02·O1) shows it in every tool.
 */
export function MeasureLoupe() {
  const { t } = useTranslation();
  const settings = useLoupeSettings((s) => s);
  const pointer = useLoupePointer();
  const tool = useApp(effectiveTool);
  const docId = pointer?.docId ?? null;
  const version = useDocuments((s) => (docId ? (s.docs[docId]?.edits ?? 0) : 0));
  const marker = useSnapping((s) =>
    pointer && s.marker?.docId === pointer.docId && s.marker.page === pointer.page
      ? s.marker
      : null,
  );
  const frame =
    pointer && loupeShown(settings, tool, LOUPE_TOOLS)
      ? pageFrame(pointer.docId, pointer.page)
      : null;
  const page = pointer?.page ?? 0;
  const thin = useThinLines();
  const draw = useCallback(
    (r: LoupeRegion): LoupeJob => {
      const f = docId ? pageFrame(docId, page) : null;
      if (!docId || !f) return { promise: Promise.reject(new Error('no page')), cancel: noop };
      // The region of the page as displayed → the page's own (unturned) rectangle.
      const a = displayedToLaid(f.rotation, f.width, f.height, {
        x: r.x / r.scale,
        y: r.y / r.scale,
      });
      const b = displayedToLaid(f.rotation, f.width, f.height, {
        x: (r.x + r.width) / r.scale,
        y: (r.y + r.height) / r.scale,
      });
      const j = renderEngine().rpc.call('loupe', {
        docId,
        pageIndex: page,
        frame: { height: f.height, originX: f.originX, originY: f.originY },
        rect: {
          origin: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
          size: { width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
        },
        scale: r.scale,
        rotation: f.rotation,
        // The page content as the view draws it (Thin Lines, M13-05).
        ...(thin ? { thin } : {}),
      });
      return {
        promise: j.promise.then((x) => x.bitmap),
        cancel: () => {
          j.cancel();
        },
      };
    },
    [docId, page, thin],
  );
  const key = `${docId ?? ''}/${String(page)}/${String(version)}/${String(frame?.rotation ?? 0)}/${String(thin)}`;
  if (!frame || !pointer) return null;
  const zoom = Math.min(MAX_ZOOM, frame.zoom * settings.mag);
  const center = laidToDisplayed(frame.rotation, frame.width, frame.height, pointer.pos);
  const m = marker ? laidToDisplayed(frame.rotation, frame.width, frame.height, marker) : null;
  const mark = m ? { x: (m.x - center.x) * zoom, y: (m.y - center.y) * zoom } : null;
  const side = LOUPE_SIDES[settings.size];
  return (
    <Loupe
      client={pointer.client}
      side={side}
      center={center}
      zoom={zoom}
      sourceKey={key}
      draw={draw}
      data-testid={LOUPE_TEST_ID}
      className="measure-loupe"
      label={marker ? t(KIND_LABEL[marker.kind]) : undefined}
    >
      {mark && marker ? (
        <span
          className={`snap-marker snap-marker--${marker.kind}`}
          data-testid="measure-loupe-marker"
          data-kind={marker.kind}
          style={{ left: side / 2 + mark.x, top: side / 2 + mark.y }}
        />
      ) : null}
    </Loupe>
  );
}
