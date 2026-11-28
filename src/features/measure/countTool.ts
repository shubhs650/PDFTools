// The Count tool (M14-07, D-75, plan §7; ADR-035 Amendment 1: one Stamp whose
// appearance is entirely ours). Each click places one count of the group
// chosen in the Count group box (countGroups.ts), with the next number of
// that group across the document (Q11, Q14, Q15): its symbol centred on the
// click, its number beside it. A ghost of the next count follows the pointer
// (MeasureOverlay). Its value, caption and Triya data follow on commit
// (measurements.ts, pageData.ts); the Render worker draws it
// (workers/render/measureAppearance.ts). Needs no scale (Q29).
import {
  PdfAnnotationSubtype,
  uuidV4,
  type PdfAnnotationObject,
  type PdfStampAnnoObject,
} from '@embedpdf/models';
import type { HandlerFactory } from '@embedpdf/plugin-annotation';
import { appStore } from '../../app/store/appStore';
import { countBounds, placeOnPage } from '../../model/measureCount';
import { BLANK_STAMP_PDF } from '../../model/measureCurve';
import { captionBoundsEP, type MeasureMeta } from '../../model/measureMarkup';
import type { Pt } from '../../model/scale';
import { countsOf, currentGroup, nextCountNumber } from './countGroups';
import { registeringDoc } from './gesture';
import { countText } from './measurements';
import { measureStore, setLive } from './measureStore';

// The ghost goes with the tool.
appStore.subscribe((st, prev) => {
  if (
    st.tool !== prev.tool &&
    st.tool !== 'measureCount' &&
    measureStore.getState().live?.kind === 'count'
  )
    setLive(null);
});

/** A count's rect: its symbol and its number's estimated box (the Render worker may grow it). */
export function countRect(meta: MeasureMeta, at: Pt, text: string) {
  const cap = meta.hideN ? null : captionBoundsEP(meta, [at], null, text);
  const [x0, y0, x1, y1] = countBounds(at, meta.size ?? 12, cap);
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}

/** The count the next click places in `docId`: its group and number. */
export function nextCount(docId: string): MeasureMeta & { color: string } {
  const counts = countsOf(docId);
  const g = currentGroup(docId, counts);
  return {
    tool: 'count',
    group: g.name,
    n: nextCountNumber(docId, g.name, counts),
    sym: g.shape,
    size: g.size,
    color: g.color,
  };
}

function opacityOf(defaults: unknown): number {
  const o = (defaults as { opacity?: unknown } | undefined)?.opacity;
  return typeof o === 'number' && o >= 0 && o <= 1 ? o : 1;
}

/** The pointer handlers of the Count tool. */
export function countHandlerFactory(): HandlerFactory<PdfAnnotationObject> {
  return {
    annotationType: PdfAnnotationSubtype.STAMP,
    create(context) {
      const { pageIndex, pageSize } = context;
      const docId = registeringDoc();
      // The next count, worked out once per pointer stay on the page (not on every move).
      let next: ReturnType<typeof nextCount> | null = null;
      const upcoming = (): ReturnType<typeof nextCount> | null => {
        if (!docId) return null;
        next ??= nextCount(docId);
        return next;
      };
      return {
        onPointerMove: (pos: Pt) => {
          const c = upcoming();
          if (!c) return;
          setLive({
            page: pageIndex,
            kind: 'count',
            pts: [placeOnPage(pos, c.size ?? 12, pageSize)],
            color: c.color,
            count: c,
          });
        },
        onPointerLeave: () => {
          setLive(null);
        },
        onClick: (pos: Pt, evt: { ctrlKey?: boolean; metaKey?: boolean } | undefined) => {
          if (evt?.ctrlKey || evt?.metaKey || !docId) return;
          const c = nextCount(docId);
          next = null;
          const at = placeOnPage(pos, c.size ?? 12, pageSize);
          const { color, ...meta } = c;
          const measure: MeasureMeta = { ...meta, pts: [at] };
          const annotation = {
            type: PdfAnnotationSubtype.STAMP,
            id: uuidV4(),
            pageIndex: context.pageIndex,
            flags: ['print'],
            strokeColor: color,
            opacity: opacityOf(context.getTool()?.defaults),
            rect: countRect(measure, at, countText(measure)),
            contents: countText(measure),
            measure,
            created: new Date(),
          } as unknown as PdfStampAnnoObject;
          context.onCommit(annotation, {
            data: BLANK_STAMP_PDF.slice().buffer,
            mimeType: 'application/pdf',
          } as never);
          // The ghost shows the one after it: the same group, the next number (no second pass
          // over the document's counts on a click).
          next = { ...c, n: (c.n ?? 0) + 1 };
          setLive({
            page: pageIndex,
            kind: 'count',
            pts: [at],
            color: next.color,
            count: next,
          });
        },
      };
    },
  };
}
