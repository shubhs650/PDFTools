// Which pages an export covers (M4-04): all, the current page, a typed range
// (the print dialog's syntax, M2-15), or the pages selected in the Thumbnails
// pane once it has multi-select (M4-09). Pure. An export writes each page once,
// in document order, whatever order or repeats the range was typed with.
import { parseRange, type RangeError } from '../print/options';

export type ScopeKind = 'all' | 'current' | 'custom' | 'selection';

export interface Scope {
  kind: ScopeKind;
  /** Range text for 'custom', e.g. "1-3, 8". */
  custom: string;
}

export type ScopeResult =
  { ok: true; pages: number[] } | { ok: false; error: RangeError | 'noSelection' };

export function resolveScope(
  scope: Scope,
  ctx: { pageCount: number; current: number; selection?: readonly number[] },
): ScopeResult {
  const all = () => Array.from({ length: ctx.pageCount }, (_, i) => i);
  switch (scope.kind) {
    case 'all':
      return { ok: true, pages: all() };
    case 'current':
      return { ok: true, pages: [Math.min(Math.max(ctx.current, 0), ctx.pageCount - 1)] };
    case 'selection': {
      const sel = (ctx.selection ?? []).filter((p) => p >= 0 && p < ctx.pageCount);
      return sel.length
        ? { ok: true, pages: [...new Set(sel)].sort((a, b) => a - b) }
        : { ok: false, error: 'noSelection' };
    }
    case 'custom': {
      const r = parseRange(scope.custom, ctx.pageCount);
      return r.ok ? { ok: true, pages: [...new Set(r.pages)].sort((a, b) => a - b) } : r;
    }
  }
}
