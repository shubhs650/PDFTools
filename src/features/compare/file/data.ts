// The comparison data (M12-20, D-65; format docs/formats/triya-comparison-v1.md)
// from the comparison's state, and back: the pairing table, each sheet's
// placement, the view's colours and switches, the layer switches, the
// differences settings, ignore zones and ticks, the close-out outcomes; for a
// text comparison its switches, colours and ticks. Read from the stores here;
// the bytes are worked out in the Work worker.
import type { PdfAnnotationObject } from '@embedpdf/models';
import { documentStore } from '../../../app/store/documentStore';
import type {
  CloseOutOutcome,
  ComparisonData,
  PairingRow,
  SheetEntry,
  SheetStatus,
  StoredZone,
} from '../../../model/compare/file/format';
import { IDENTITY, type Affine } from '../../../model/compare/material';
import type { PairRow } from '../../../model/compare/pairing';
import type { AlignStatus } from '../../../model/compare/align/aligner';
import type { LayerStates } from '../../../workers/shared/layerCopy';
import type { DataFields } from '../../../workers/work/comparisonFile/build';
import { objectsOf } from '../../annotate/comments/commentsStore';
import { annotationState } from '../../annotate/selection';
import { closeOutRows, type Outcome } from '../closeout/closeOutModel';
import { diffView, type DiffView, type IgnoreZone } from '../diff/diffState';
import type { Comparison } from '../model';
import { pairingStore } from '../pairingFlow';
import {
  alignmentOf,
  overlayView,
  placeOf,
  type OverlayView,
  type Sheet,
} from '../overlay/overlayState';
import { comparisonSheets } from '../overlay/vectorOverlay';
import { textStore, DEFAULT_TEXT_VIEW, type TextView } from '../text/textFlow';
import { APP_NAME } from './words';

const STATUS: Record<AlignStatus, SheetStatus> = {
  'as-is': 'asIs',
  auto: 'aligned',
  low: 'lowConfidence',
  manual: 'manual',
};

const isIdentity = (m: Affine): boolean =>
  m.every((v, i) => Math.abs(v - (IDENTITY[i] ?? 0)) < 1e-9);

/** A sheet as the file stores it: [file index, page] per side, A's placement, how it was found. */
export function sheetEntry(view: OverlayView, s: Sheet): SheetEntry {
  const place = s.a && s.b ? placeOf(view, s) : IDENTITY;
  const al = alignmentOf(view, s);
  return {
    a: s.a ? [s.a.file, s.a.page] : null,
    b: s.b ? [s.b.file, s.b.page] : null,
    ...(isIdentity(place) ? {} : { aToB: [...place] }),
    status: al ? STATUS[al.status] : 'asIs',
  };
}

const OUTCOME: Record<Outcome, CloseOutOutcome> = {
  addressed: 'addressed',
  carried: 'carriedOver',
  changed: 'changedDifferently',
};

/** The close-out outcomes of Document A's comments (D-62): also written into A itself. */
export function closeOutOf(docIds: readonly string[]): ComparisonData['closeOut'] {
  const out: ComparisonData['closeOut'] = [];
  for (const docId of docIds) {
    const st = annotationState(docId);
    const all: PdfAnnotationObject[] = st ? objectsOf(st.byUid) : [];
    for (const row of closeOutRows(all)) {
      if (row.state === 'open' || row.state === 'completed') continue;
      out.push({ nm: row.id, outcome: OUTCOME[row.state] });
    }
  }
  return out;
}

/** Ignore zones as the file stores them: a compared sheet 1-based, or every sheet. */
export const storedZones = (zones: readonly IgnoreZone[]): StoredZone[] =>
  zones.map((z) => ({ sheet: z.pair === null ? null : z.pair + 1, rect: [...z.box] }));

/** Layer switches by side and file index (the file's documents get new ids when reopened). */
function layersBySide(c: Comparison, view: OverlayView) {
  const side = (s: 'a' | 'b'): Record<string, LayerStates> => {
    const out: Record<string, LayerStates> = {};
    c[s].forEach((f, i) => {
      const states = view.layers[f.docId];
      if (states && Object.keys(states).length) out[String(i)] = states;
    });
    return out;
  };
  return { A: side('a'), B: side('b') };
}

/** The overlay view's settings kept in the file. */
export interface OverlayOptions {
  style: OverlayView['style'];
  thicken: boolean;
  layout: OverlayView['layout'];
  lock: boolean;
  vector: boolean;
  comments: OverlayView['comments'];
  layers: { A: Record<string, LayerStates>; B: Record<string, LayerStates> };
  diff: Pick<DiffView, 'sensitivity' | 'minSize' | 'outlines'>;
}

/** The text view's settings kept in the file. */
export interface TextOptions {
  run: TextView['options'];
  colours: TextView['colours'];
  sync: boolean;
}

/** The data of a PDF overlay (its pairing must be done). */
export function overlayFields(
  c: Comparison,
  created: string,
): DataFields & {
  sheets: SheetEntry[];
} {
  const view = overlayView(c.id);
  const diff = diffView(c.id);
  const rows: PairRow[] = pairingStore.getState().byId[c.id]?.rows ?? [];
  const pairing: PairingRow[] = rows.map((r) => ({
    a: r.a,
    b: r.b,
    ...(r.excluded ? { excluded: true } : {}),
  }));
  const options: OverlayOptions = {
    style: view.style,
    thicken: view.thicken,
    layout: view.layout,
    lock: view.lock,
    vector: view.vector,
    comments: view.comments,
    layers: layersBySide(c, view),
    diff: { sensitivity: diff.sensitivity, minSize: diff.minSize, outlines: diff.outlines },
  };
  return {
    created,
    app: APP_NAME(),
    sheets: (comparisonSheets(c.id) ?? []).map((s) => sheetEntry(view, s)),
    pairing,
    // An area comparison (O1) keeps its two rectangles.
    ...(c.area ? { area: { a: [...c.area.a], b: [...c.area.b] } } : {}),
    options: options as unknown as Record<string, unknown>,
    ignoreZones: storedZones(diff.zones),
    checked: [...diff.checked],
    closeOut: closeOutOf(c.a.map((f) => f.docId)),
  };
}

/** The data of a text comparison. */
export function textFields(c: Comparison, created: string): DataFields {
  const v = textStore.getState().views[c.id] ?? DEFAULT_TEXT_VIEW;
  const options: TextOptions = { run: v.options, colours: v.colours, sync: v.sync };
  return {
    created,
    app: APP_NAME(),
    options: options as unknown as Record<string, unknown>,
    ignoreZones: [],
    checked: [...v.checked],
    closeOut: closeOutOf(c.a.map((f) => f.docId)),
  };
}

/** The documents of a comparison by side, with their file names and page ranges. */
export function sidesOf(c: Comparison) {
  const docs = documentStore.getState().docs;
  const side = (s: 'a' | 'b') =>
    c[s].map((f) => ({ docId: f.docId, name: docs[f.docId]?.meta.name ?? '', range: f.range }));
  return { A: side('a'), B: side('b') };
}
