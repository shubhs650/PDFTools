// Editing a placed measurement point by point (M14-04, D-78, Q24): the
// handles of the selected measurement (MeasureEditor.tsx) drag its points or
// a Length's dimension line, with the value live, snapping, Shift (0°, 45°,
// 90°, still snapping) and the loupe; a right-click on an edge adds a point,
// on a point removes it (the comment menu otherwise). Each edit is one plugin
// update, so one undo step with its value and caption (historyJoin.ts). The
// plugin's own vertex handles stay off measurements (AnnotationLayer.tsx).
// An Area's or Volume's cutouts (M14-06, Q8) are edited the same way: their
// points dragged, added and removed, a hole kept inside the outline and clear
// of the others; an outline edited so that a hole no longer fits drops that
// hole, with a note (Undo brings it back).
// No PDF work here (rule 1): plain arithmetic, then the plugin's update.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { documentStore, securityOf } from '../../app/store/documentStore';
import type { PagePoint } from '../../app/commands/dispatch';
import { leaderFor, leaderOf, offsetOf } from '../../model/dimension';
import { curveValue, isCurveTool } from '../../model/measureCurve';
import { handlesOf, pointAction, storedOf, type PointAction } from '../../model/measureEdit';
import { isAreaTool, metaOf, type MeasureMeta, type MeasureTool } from '../../model/measureMarkup';
import { holeProblem, holesThatFit } from '../../model/measureQuantity';
import { format, t } from '../../i18n';
import { showStatusToast } from '../snapshot/snapshot';
import { measurePoints } from '../../model/measurement';
import { allows } from '../../model/permissions';
import type { Pt } from '../../model/scale';
import { isFixed } from '../annotate/properties/model';
import { annotationCapability } from '../annotate/selection';
import { snapAngle } from '../annotate/tools/drawModel';
import { loupeSettingsStore } from './loupeSettings';
import { hideLoupe, loupeStore } from './loupePointer';
import { measureRect } from './measurements';
import { clearSnapMarker, snapPointIn } from './snapping';

/** A right-click this close to a point (CSS px) is on it; to an edge, beside it. */
export const POINT_HIT_PX = 7;
export const EDGE_HIT_PX = 5;

/** The measurement being dragged: its preview, drawn instead of it until the drag ends. */
export interface EditPreview {
  docId: string;
  id: string;
  object: PdfAnnotationObject;
}

export const pointEditStore = createStore<{ preview: EditPreview | null }>()(() => ({
  preview: null,
}));

/** The preview of measurement `id` while one of its handles is dragged, else null. */
export function useEditPreview(docId: string | null, id?: string): EditPreview | null {
  return useStore(pointEditStore, (s) =>
    s.preview?.docId === docId && (id === undefined || s.preview.id === id) ? s.preview : null,
  );
}

export function setPreview(p: EditPreview | null): void {
  pointEditStore.setState({ preview: p });
}

/** What can be edited of a measurement: its tool and the points with handles. */
export interface EditTarget {
  tool: MeasureTool;
  handles: Pt[];
}

/** A measurement (one markup, M14-03) whose points can be edited by this person now. */
export function editTarget(docId: string, a: PdfAnnotationObject): EditTarget | null {
  const meta = metaOf(a);
  // A Count is one point: it moves as a whole, with the plugin's own drag (M14-07).
  if (!meta || meta.tool === 'count' || isFixed(a)) return null;
  const doc = documentStore.getState().docs[docId];
  if (!doc || !allows(securityOf(doc.meta), 'annotate')) return null;
  return { tool: meta.tool, handles: handlesOf(meta.tool, measurePoints(a)) };
}

/** The measurement with these handle points (and its rect, as the plugin's vertex edit makes it). */
export function withHandles(
  a: PdfAnnotationObject,
  tool: MeasureTool,
  handles: readonly Pt[],
): PdfAnnotationObject {
  const stored = storedOf(tool, handles);
  const meta = metaOf(a);
  if (isCurveTool(tool) && meta) {
    // An Angle, Radius or Diameter (a Stamp, M14-05): its points are in its meta,
    // its rect holds its drawing and caption (the Render worker redraws it).
    const next = { ...meta, pts: stored };
    const moved = { ...a, measure: next } as unknown as PdfAnnotationObject;
    return { ...moved, rect: measureRect(moved, next, a.contents ?? '') };
  }
  const changes =
    a.type === PdfAnnotationSubtype.LINE
      ? { linePoints: { start: stored[0] ?? { x: 0, y: 0 }, end: stored[1] ?? { x: 0, y: 0 } } }
      : { vertices: stored };
  const merged = { ...a, ...changes } as PdfAnnotationObject;
  const cap = annotationCapability();
  if (!cap) return merged;
  try {
    // The tool's own transform (a Length keeps its leader lines inside, M13-10).
    const patched = cap.transformAnnotation(a, { type: 'vertex-edit', changes: merged });
    return { ...merged, ...patched } as PdfAnnotationObject;
  } catch {
    return merged;
  }
}

/** An Area's or Volume's cutouts (M14-06), EmbedPDF page points. */
export const holesOf = (a: PdfAnnotationObject): Pt[][] => metaOf(a)?.holes ?? [];

/** The measurement with hole `k`'s points replaced (null: the hole removed). */
export function withHole(
  a: PdfAnnotationObject,
  k: number,
  pts: readonly Pt[] | null,
): PdfAnnotationObject {
  const meta = metaOf(a);
  if (!meta) return a;
  const holes = (meta.holes ?? []).flatMap((h, i) =>
    i !== k ? [h] : pts ? [pts.map((p) => ({ x: p.x, y: p.y }))] : [],
  );
  const next: MeasureMeta = { ...meta, holes };
  if (!holes.length) delete next.holes;
  return { ...a, measure: next } as unknown as PdfAnnotationObject;
}

/** A Length with its dimension line through `p` (the leader lines' length, Q24). */
export function withOffsetAt(a: PdfAnnotationObject, p: Pt): PdfAnnotationObject {
  const [s, e] = measurePoints(a);
  if (!s || !e) return a;
  const leader = leaderFor(offsetOf(s, e, p, true));
  return { ...a, leader } as unknown as PdfAnnotationObject;
}

/** The measurement's update for a finished edit, as the plugin's update takes it. */
function patchOf(before: PdfAnnotationObject, after: PdfAnnotationObject) {
  const o = after as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = { rect: after.rect };
  if (after.type === PdfAnnotationSubtype.STAMP) patch['measure'] = o['measure'];
  else if (after.type === PdfAnnotationSubtype.LINE) patch['linePoints'] = o['linePoints'];
  else patch['vertices'] = o['vertices'];
  // An Area or Volume keeps its cutouts, depth and units with it (M14-06): one
  // read from a file has them in its Triya data only, which an edit outdates.
  const meta = metaOf(after);
  if (meta && isAreaTool(meta.tool)) patch['measure'] = o['measure'];
  if ('leader' in o && o['leader'] !== (before as unknown as Record<string, unknown>)['leader'])
    patch['leader'] = o['leader'] ?? null;
  return patch as Partial<PdfAnnotationObject>;
}

/** Commits an edited measurement as one undo step (its value and caption join it). */
export function commitEdit(
  docId: string,
  before: PdfAnnotationObject,
  edited: PdfAnnotationObject,
) {
  const scope = annotationCapability()?.forDocument(docId);
  if (!scope) return;
  const after = withFittingHoles(docId, before, edited);
  if (!after) return;
  const same =
    JSON.stringify(measurePoints(before)) === JSON.stringify(measurePoints(after)) &&
    JSON.stringify(leaderOf(before)) === JSON.stringify(leaderOf(after)) &&
    JSON.stringify(holesOf(before)) === JSON.stringify(holesOf(after));
  if (same) return;
  // A curve whose points no longer make one (in a line, on top of each other) stays as it was.
  const meta = metaOf(after);
  if (meta && isCurveTool(meta.tool) && curveValue(meta.tool, measurePoints(after)) === null)
    return;
  scope.updateAnnotation(before.pageIndex, before.id, patchOf(before, after));
}

/**
 * An Area's or Volume's edit checked against its cutouts (M14-06, Q8): an
 * edited hole must stay inside the outline and clear of the others (else
 * null: nothing changes, and a note says why); an edited outline keeps the
 * holes that still fit and drops the others, with a note.
 */
function withFittingHoles(
  docId: string,
  before: PdfAnnotationObject,
  after: PdfAnnotationObject,
): PdfAnnotationObject | null {
  const meta = metaOf(after);
  if (!meta || !isAreaTool(meta.tool) || !meta.holes?.length) return after;
  const outer = measurePoints(after);
  const was = holesOf(before);
  const holes = meta.holes;
  if (JSON.stringify(outer) === JSON.stringify(measurePoints(before))) {
    // A hole edited: the one that changed must still fit.
    const k = holes.findIndex((h, i) => JSON.stringify(h) !== JSON.stringify(was[i]));
    const hole = holes[k];
    const problem = hole && holes.length === was.length ? holeProblem(outer, holes, hole, k) : null;
    if (problem) {
      showStatusToast(
        docId,
        t(problem === 'overlap' ? 'measure.cutout.overlap' : 'measure.cutout.outside'),
        false,
      );
      return null;
    }
    return after;
  }
  const kept = holesThatFit(outer, holes);
  if (kept.length === holes.length) return after;
  const dropped = holes.length - kept.length;
  showStatusToast(
    docId,
    t('measure.cutout.dropped', { count: dropped, n: format.number(dropped, 0) }),
    false,
  );
  const next: MeasureMeta = { ...meta, holes: kept };
  if (!kept.length) delete next.holes;
  return { ...after, measure: next } as unknown as PdfAnnotationObject;
}

// ---- where a dragged point lands -------------------------------------------------

const zoomOf = (docId: string): number => documentStore.getState().docs[docId]?.view.scale ?? 1;

/**
 * A dragged point (EmbedPDF page points): Shift locks it to 0°, 45° or 90°
 * from `anchor` and still snaps where that direction meets a drawn line;
 * otherwise it snaps to the drawing. Snapping works while editing when it is
 * on, or when measuring turns it on by itself (D-68); Alt: no snapping.
 */
export function editPoint(
  docId: string,
  page: number,
  pos: Pt,
  evt: { shiftKey?: boolean; altKey?: boolean },
  anchor: Pt | null,
): Pt {
  const force = loupeSettingsStore.getState().autoSnap;
  const zoom = zoomOf(docId);
  if (evt.shiftKey && anchor) {
    const locked = snapAngle(anchor, pos);
    return snapPointIn(docId, page, locked, evt, { force, zoom, from: anchor });
  }
  return snapPointIn(docId, page, pos, evt, { force, zoom });
}

/** The loupe follows a dragged point (when the Measure loupe is on, M13-02). */
export function trackEditLoupe(docId: string, page: number, pos: Pt, client: Pt): void {
  if (!loupeSettingsStore.getState().on) return;
  loupeStore.setState({ pointer: { docId, page, pos: { ...pos }, client }, editing: true });
}

/** A drag is over: no preview, loupe or snap marker. */
export function endEdit(): void {
  setPreview(null);
  if (loupeStore.getState().editing) loupeStore.setState({ editing: false });
  hideLoupe();
  clearSnapMarker();
}

// ---- right-click (Q24) -------------------------------------------------------------

/**
 * The selected measurement under a right-click, and what the click would do
 * to it: to its points, or to one of its cutouts' (`hole`, M14-06).
 */
export function rightClickAction(
  docId: string,
  at: PagePoint,
): {
  annotation: PdfAnnotationObject;
  tool: MeasureTool;
  action: PointAction;
  hole?: number;
} | null {
  const scope = annotationCapability()?.forDocument(docId);
  const sel = scope?.getSelectedAnnotations() ?? [];
  const a = sel.length === 1 ? sel[0]?.object : undefined;
  if (!a) return null;
  if (a.pageIndex !== at.page) return null;
  const target = editTarget(docId, a);
  if (!target) return null;
  const zoom = zoomOf(docId);
  const width = (a as { strokeWidth?: number }).strokeWidth ?? 1;
  const p = { x: at.x, y: at.y };
  const pointTol = POINT_HIT_PX / zoom;
  const edgeTol = EDGE_HIT_PX / zoom + width / 2;
  const action = pointAction(target.tool, target.handles, p, pointTol, edgeTol);
  if (action) return { annotation: a, tool: target.tool, action };
  // A cutout's points and edges, each hole a closed shape of three or more (Q8, Q24).
  const holes = isAreaTool(target.tool) ? holesOf(a) : [];
  for (let k = 0; k < holes.length; k++) {
    const h = pointAction('area', holes[k] ?? [], p, pointTol, edgeTol);
    if (h) return { annotation: a, tool: target.tool, action: h, hole: k };
  }
  return null;
}

/**
 * A right-click in the document (DocumentMenu, before the menu opens): on an
 * edge of the selected measurement it adds a point there, on one of its
 * points it removes it. True when it did (the menu stays shut).
 */
export function pointFromRightClick(docId: string, at: PagePoint | null): boolean {
  if (!at) return false;
  const hit = rightClickAction(docId, at);
  if (!hit?.action) return false;
  commitEdit(
    docId,
    hit.annotation,
    hit.hole === undefined
      ? withHandles(hit.annotation, hit.tool, hit.action.handles)
      : withHole(hit.annotation, hit.hole, hit.action.handles),
  );
  return true;
}
