// A comparison file's data back into a live comparison (M12-20, D-65): the
// pairing table, each sheet's placement set by hand, the view's colours and
// switches, the layer switches, the differences settings, ignore zones and
// ticks; for a text comparison its switches, colours and ticks. The
// alignments found automatically, the differences and the text result are
// worked out again (they are the same: rules only, D-60). Pure where it can
// be (`overlayRestore`, `textRestore`); the stores are set here.
import type { ComparisonData, StoredZone } from '../../../model/compare/file/format';
import type { Affine } from '../../../model/compare/material';
import type { PairRow } from '../../../model/compare/pairing';
import type { LayerStates } from '../../../workers/shared/layerCopy';
import { updateDiff, type DiffView, type IgnoreZone } from '../diff/diffState';
import type { Comparison } from '../model';
import type { CompareSession } from '../engine/session';
import {
  DEFAULT_VIEW,
  setAlignChecked,
  updateView,
  type OverlayView,
  type Sheet,
} from '../overlay/overlayState';
import { restorePairing } from '../pairingFlow';
import { DEFAULT_TEXT_VIEW, updateTextView, type TextView } from '../text/textFlow';
import type { OverlayOptions, TextOptions } from './data';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `opt[key]` when it has the type of `fallback` (a newer or edited file can hold anything). */
function pick<T>(opt: Record<string, unknown>, key: string, fallback: T): T {
  const v = opt[key];
  if (fallback === null) return (v === undefined ? fallback : v) as T;
  if (Array.isArray(fallback)) return (Array.isArray(v) ? v : fallback) as T;
  if (typeof fallback === 'object')
    return (isObject(v) ? { ...(fallback as object), ...v } : fallback) as T;
  return (typeof v === typeof fallback ? v : fallback) as T;
}

let zoneSeq = 0;

/** Ignore zones as the view holds them (a compared sheet 0-based, or every sheet). */
export const zonesFrom = (zones: readonly StoredZone[]): IgnoreZone[] =>
  zones.flatMap((z) =>
    Array.isArray(z.rect) && (z.rect as number[]).length === 4 && z.rect.every(Number.isFinite)
      ? [
          {
            id: `f${String(++zoneSeq)}`,
            pair: typeof z.sheet === 'number' && z.sheet >= 1 ? z.sheet - 1 : null,
            box: [...z.rect] as IgnoreZone['box'],
          },
        ]
      : [],
  );

/** Layer switches by document id, from the file's side and file index. */
function layersOf(c: Comparison, stored: unknown): Record<string, LayerStates> {
  const out: Record<string, LayerStates> = {};
  if (!isObject(stored)) return out;
  for (const s of ['a', 'b'] as const) {
    const side = stored[s.toUpperCase()];
    if (!isObject(side)) continue;
    c[s].forEach((f, i) => {
      const states = side[String(i)];
      if (isObject(states)) out[f.docId] = states as LayerStates;
    });
  }
  return out;
}

export interface OverlayRestore {
  view: Partial<OverlayView>;
  diff: Partial<DiffView>;
  rows: PairRow[] | null;
  /** Placements set by hand, by sheet index in the file (pairs only). */
  manual: Map<number, Affine>;
  /** Sheets whose uncertain alignment the user accepted ("Checked by you"), by sheet index. */
  checked: Set<number>;
}

/** What a PDF overlay's data restores (pure). */
export function overlayRestore(c: Comparison, data: ComparisonData): OverlayRestore {
  const opt = data.options;
  const d = DEFAULT_VIEW;
  const diffOpt = pick<Partial<OverlayOptions['diff']>>(opt, 'diff', {});
  const view: Partial<OverlayView> = {
    style: pick(opt, 'style', d.style),
    thicken: pick(opt, 'thicken', d.thicken),
    layout: pick(opt, 'layout', d.layout) === 'overlay' ? 'overlay' : 'review',
    lock: pick(opt, 'lock', d.lock),
    vector: pick(opt, 'vector', d.vector),
    comments: pick(opt, 'comments', d.comments),
    layers: layersOf(c, opt['layers']),
  };
  const sens = diffOpt.sensitivity;
  const diff: Partial<DiffView> = {
    ...(sens === 'low' || sens === 'normal' || sens === 'high' ? { sensitivity: sens } : {}),
    ...(typeof diffOpt.minSize === 'number' && diffOpt.minSize >= 0
      ? { minSize: diffOpt.minSize }
      : {}),
    ...(typeof diffOpt.outlines === 'boolean' ? { outlines: diffOpt.outlines } : {}),
    zones: zonesFrom(data.ignoreZones),
    checked: data.checked.filter((x) => typeof x === 'string'),
  };
  const rows =
    data.pairing?.map((r) => ({ a: r.a, b: r.b, excluded: r.excluded === true })) ?? null;
  const manual = new Map<number, Affine>();
  const checked = new Set<number>();
  data.sheets?.forEach((s, i) => {
    if (s.status === 'manual' && Array.isArray(s.aToB) && s.aToB.length === 6)
      manual.set(i, [...s.aToB] as unknown as Affine);
    else if (s.checked === true) checked.add(i);
  });
  return { view, diff, rows, manual, checked };
}

/** What a text comparison's data restores (pure). */
export function textRestore(data: ComparisonData): Partial<TextView> {
  const opt = data.options;
  const d = DEFAULT_TEXT_VIEW;
  const o: Partial<TextOptions> = {
    run: pick(opt, 'run', d.options),
    colours: pick(opt, 'colours', d.colours),
    sync: pick(opt, 'sync', d.sync),
  };
  return {
    ...(o.run ? { options: o.run } : {}),
    ...(o.colours ? { colours: o.colours } : {}),
    ...(o.sync === undefined ? {} : { sync: o.sync }),
    checked: data.checked.filter((x) => typeof x === 'string'),
  };
}

/** Placements set by hand, and sheets checked by the user, still to apply once the session starts. */
const pendingManual = new Map<string, { manual: Map<number, Affine>; checked: Set<number> }>();

/** Sets the stores of a comparison about to open from a comparison file. */
export function restoreComparison(c: Comparison, data: ComparisonData): void {
  if (c.type === 'text') {
    const v = textRestore(data);
    updateTextView(c.id, (cur) => ({ ...cur, ...v }));
    return;
  }
  const r = overlayRestore(c, data);
  updateView(c.id, (cur) => ({ ...cur, ...r.view }));
  updateDiff(c.id, (cur) => ({ ...cur, ...r.diff }));
  if (r.rows && !c.area) restorePairing(c.id, r.rows);
  if (r.manual.size || r.checked.size)
    pendingManual.set(c.id, { manual: r.manual, checked: r.checked });
}

/**
 * Once the comparison's session starts on the restored pairing: the sheets
 * placed by hand get their placement back, and the sheets the user checked
 * are "Checked by you" again (the result's start calls this).
 */
export function applyRestoredPlaces(
  id: string,
  session: CompareSession,
  sheets: readonly Sheet[],
): void {
  const pending = pendingManual.get(id);
  if (!pending) return;
  pendingManual.delete(id);
  for (const [i, place] of pending.manual) {
    const pair = sheets[i]?.pair;
    if (pair !== null && pair !== undefined) session.setManual(pair, place);
  }
  const pairs = [...pending.checked].flatMap((i) => {
    const pair = sheets[i]?.pair;
    return pair === null || pair === undefined ? [] : [pair];
  });
  if (pairs.length) updateView(id, (v) => pairs.reduce((w, p) => setAlignChecked(w, p), v));
}
