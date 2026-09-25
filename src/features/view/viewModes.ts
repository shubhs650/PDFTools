// View modes and view rotation (§5, M1-16, ADR-011 decision 6). Continuous
// and continuous facing are the scroll + spread plugins. Single page and
// facing are our paged mode over the same scroller: only the current page or
// spread is shown and scrolling is held within it; the wheel and PageUp/Down
// move by page or spread. Rotation is a view setting (rotate plugin), never a
// document change.
import type { Rotation, ViewMode } from '../../app/store/documentStore';

export const VIEW_MODES: readonly ViewMode[] = [
  'single',
  'continuous',
  'facing',
  'continuousFacing',
];

export const isPaged = (mode: ViewMode): boolean => mode === 'single' || mode === 'facing';
export const isFacing = (mode: ViewMode): boolean =>
  mode === 'facing' || mode === 'continuousFacing';

/**
 * Pages grouped as displayed. Facing pairs 1–2, 3–4 … ; with `cover`, page 1
 * stands alone and pairs start at 2–3 (the spread plugin's "even" mode).
 */
export function spreadsFor(pageCount: number, facing: boolean, cover = false): number[][] {
  const out: number[][] = [];
  let i = 0;
  if (facing && cover && pageCount > 0) out.push([i++]);
  while (i < pageCount) {
    if (facing && i + 1 < pageCount) {
      out.push([i, i + 1]);
      i += 2;
    } else {
      out.push([i++]);
    }
  }
  return out;
}

/** The spread (index into `spreads`) that holds `pageIndex`. */
export function spreadIndexOf(spreads: readonly number[][], pageIndex: number): number {
  const i = spreads.findIndex((s) => s.includes(pageIndex));
  return i < 0 ? 0 : i;
}

export interface Span {
  top: number;
  bottom: number;
}

/**
 * Scroll-top range that keeps a paged view on its spread: from the spread's
 * top (less the gap) to where its bottom (plus the gap) meets the viewport's
 * bottom; a spread shorter than the viewport has a single position.
 */
export function pagedScrollRange(span: Span, viewportHeight: number, gap: number): Span {
  const top = span.top - gap;
  const bottom = Math.max(top, span.bottom + gap - viewportHeight);
  return { top, bottom };
}

export function clampToRange(value: number, range: Span): number {
  return Math.min(range.bottom, Math.max(range.top, value));
}

/** Union of page boxes (mixed sizes in one spread). */
export function unionSpan(spans: readonly Span[]): Span | null {
  if (spans.length === 0) return null;
  return {
    top: Math.min(...spans.map((s) => s.top)),
    bottom: Math.max(...spans.map((s) => s.bottom)),
  };
}

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** View rotation after a 90° turn clockwise (dir 1) or counterclockwise (-1). */
export function rotateView(current: Rotation, dir: 1 | -1): Rotation {
  const i = ROTATIONS.indexOf(current);
  return ROTATIONS[(i + dir + 4) % 4] ?? 0;
}

/** EmbedPDF quarter turns ↔ degrees. */
export const toQuarterTurns = (r: Rotation): 0 | 1 | 2 | 3 => (r / 90) as 0 | 1 | 2 | 3;
export const fromQuarterTurns = (q: number): Rotation => ROTATIONS[((q % 4) + 4) % 4] ?? 0;
