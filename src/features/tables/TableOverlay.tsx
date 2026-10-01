import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import {
  addCol,
  addRow,
  bbox,
  cellBox,
  moveCol,
  moveRow,
  removeCol,
  removeRow,
  type TableGrid,
} from '../../model/tableGrid';
import { frameOf } from '../measure/viewports';
import {
  addDrawn,
  cancelKeyRect,
  commitKeyRect,
  dragGrid,
  editGrid,
  endDrag,
  gridOf,
  nudgeKeyRect,
  selectTable,
  useReview,
  type Box,
} from './reviewStore';

type Frame = ReturnType<typeof frameOf>;

/** User space → points from the page's top-left (the layer's CSS pixels / scale). */
const view = (f: Frame, box: Box) => ({
  left: box[0] - f.originX,
  top: f.originY + f.height - box[3],
  width: box[2] - box[0],
  height: box[3] - box[1],
});

const px = (r: ReturnType<typeof view>, scale: number) => ({
  left: r.left * scale,
  top: r.top * scale,
  width: r.width * scale,
  height: r.height * scale,
});

/** Divider step for the arrow keys (points); with Shift. */
const STEP = 1;
const STEP_FAR = 10;

/**
 * Review & Extract's outlines on a page (M4-14): every table's outline
 * (dashed while proposed), the selected table's header rows, merged cells and
 * dividers. Dividers drag with the pointer and are focusable separators:
 * arrows move them, Delete removes, Insert adds one (M4-Q10). With the draw
 * tool, dragging on the page draws a new table; the keyboard rectangle starts
 * at the page's centre (arrows move, Shift+arrows resize, Enter adds).
 */
export function TableOverlay({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const active = useReview((s) => s.docId === documentId);
  if (!active) return null;
  return <Layer documentId={documentId} pageIndex={pageIndex} scale={scale} />;
}

interface Drag {
  kind: 'col' | 'row' | 'draw';
  id: string;
  k: number;
  base: TableGrid | null;
  start: [number, number];
  frame: number;
}

function Layer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const tables = useReview((s) => s.doc.tables);
  const selectedId = useReview((s) => s.selectedId);
  const selectedGrid = useReview((s) => (s.selectedId ? gridOf(s, s.selectedId) : null));
  const tool = useReview((s) => s.tool);
  const keyRect = useReview((s) => (s.keyRect?.page === pageIndex ? s.keyRect.box : null));
  const draft = useRef<HTMLDivElement>(null);
  const keyEl = useRef<HTMLDivElement>(null);
  const f = frameOf(documentId, pageIndex);
  const onPage = tables.filter((x) => x.grid.page === pageIndex);

  useEffect(() => {
    if (keyRect) keyEl.current?.focus();
  }, [keyRect !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The pointer in user space (offsetX/Y: the layer's own, unrotated coordinates). */
  const at = (e: PointerEvent): [number, number] => [
    f.originX + e.nativeEvent.offsetX / scale,
    f.originY + f.height - e.nativeEvent.offsetY / scale,
  ];

  const startDividerDrag = (e: PointerEvent, kind: 'col' | 'row', k: number) => {
    if (e.button !== 0 || !selectedId || !selectedGrid) return;
    e.preventDefault();
    e.stopPropagation();
    root.current?.setPointerCapture(e.pointerId);
    drag.current = { kind, id: selectedId, k, base: selectedGrid, start: [0, 0], frame: 0 };
    root.current?.classList.add('table-layer--dragging');
  };

  const onPointerDown = (e: PointerEvent) => {
    if (tool !== 'draw' || e.button !== 0 || e.target !== root.current) return;
    e.preventDefault();
    e.stopPropagation();
    root.current.setPointerCapture(e.pointerId);
    drag.current = { kind: 'draw', id: '', k: 0, base: null, start: at(e), frame: 0 };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const [x, y] = at(e);
    if (d.kind === 'draw') {
      const el = draft.current;
      if (!el) return;
      const box: Box = [
        Math.min(d.start[0], x),
        Math.min(d.start[1], y),
        Math.max(d.start[0], x),
        Math.max(d.start[1], y),
      ];
      Object.assign(el.style, pxStyle(px(view(f, box), scale)), { display: 'block' });
      return;
    }
    // One store update per frame however fast the pointer moves.
    cancelAnimationFrame(d.frame);
    d.frame = requestAnimationFrame(() => {
      if (!d.base) return;
      dragGrid(d.id, d.kind === 'col' ? moveCol(d.base, d.k, x) : moveRow(d.base, d.k, y));
    });
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    drag.current = null;
    root.current?.classList.remove('table-layer--dragging');
    if (d.kind === 'draw') {
      if (draft.current) draft.current.style.display = 'none';
      const [x, y] = at(e);
      addDrawn(pageIndex, [
        Math.min(d.start[0], x),
        Math.min(d.start[1], y),
        Math.max(d.start[0], x),
        Math.max(d.start[1], y),
      ]);
      return;
    }
    cancelAnimationFrame(d.frame);
    if (d.base) {
      const [x, y] = at(e);
      dragGrid(d.id, d.kind === 'col' ? moveCol(d.base, d.k, x) : moveRow(d.base, d.k, y));
    }
    endDrag(true);
  };

  const onPointerCancel = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(d.frame);
    root.current?.classList.remove('table-layer--dragging');
    if (draft.current) draft.current.style.display = 'none';
    if (d.kind !== 'draw') endDrag(false);
  };

  const dividerKey = (e: KeyboardEvent, kind: 'col' | 'row', k: number) => {
    if (!selectedId || !selectedGrid) return;
    const g = selectedGrid;
    const step = e.shiftKey ? STEP_FAR : STEP;
    const pos = kind === 'col' ? (g.cols[k] ?? 0) : (g.rows[k] ?? 0);
    const n = kind === 'col' ? g.cols.length : g.rows.length;
    let next: TableGrid | null = null;
    if (kind === 'col' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      next = moveCol(g, k, pos + (e.key === 'ArrowLeft' ? -step : step));
    else if (kind === 'row' && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))
      next = moveRow(g, k, pos + (e.key === 'ArrowUp' ? step : -step));
    else if (e.key === 'Delete' || e.key === 'Backspace')
      next = kind === 'col' ? removeCol(g, k) : removeRow(g, k);
    else if (e.key === 'Insert') {
      // A new divider halfway to the next one (the previous one at the far edge).
      const list = kind === 'col' ? g.cols : g.rows;
      const other = k < n - 1 ? list[k + 1] : list[k - 1];
      if (other !== undefined) {
        const mid = (pos + other) / 2;
        next = kind === 'col' ? addCol(g, mid) : addRow(g, mid);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      document.querySelector<HTMLElement>('[data-review-selected]')?.focus();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (next && next !== g) editGrid(selectedId, next);
  };

  const keyRectKey = (e: KeyboardEvent) => {
    const step = e.ctrlKey || e.metaKey ? STEP_FAR : 5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (m) nudgeKeyRect(m[0], m[1], e.shiftKey);
    else if (e.key === 'Enter') commitKeyRect();
    else if (e.key === 'Escape') cancelKeyRect();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const sel = onPage.find((x) => x.id === selectedId);
  const g = sel ? selectedGrid : null;
  // Hit areas: up to 9 px, at most 40 % of the narrowest gap so dense grids stay reachable;
  // column dividers sit above row dividers where they cross.
  const hit = (list: readonly number[]) => {
    let gap = Infinity;
    for (let i = 1; i < list.length; i++)
      gap = Math.min(gap, Math.abs((list[i] ?? 0) - (list[i - 1] ?? 0)));
    return Math.max(3, Math.min(9, Math.floor(gap * scale * 0.4)));
  };
  const colHit = g ? hit(g.cols) : 9;
  const rowHit = g ? hit(g.rows) : 9;
  return (
    <div
      ref={root}
      className={`table-layer${tool === 'draw' ? ' table-layer--draw' : ''}`}
      data-testid="table-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      {onPage.map((tb) => {
        const grid = tb.id === selectedId && g ? g : tb.grid;
        const r = px(view(f, bbox(grid)), scale);
        return (
          <div
            key={tb.id}
            className="table-outline"
            data-testid="table-outline"
            data-selected={tb.id === selectedId || undefined}
            data-accepted={tb.accepted || undefined}
            aria-hidden="true"
            style={pxStyle(r)}
            onPointerDown={(e) => {
              if (tool === 'draw' || e.button !== 0) return;
              e.stopPropagation();
              selectTable(tb.id);
            }}
            onDoubleClick={(e) => {
              if (tb.id !== selectedId) return;
              // offsetX/Y are the outline's own coordinates (its children don't take the pointer).
              const x = f.originX + (r.left + e.nativeEvent.offsetX) / scale;
              const y = f.originY + f.height - (r.top + e.nativeEvent.offsetY) / scale;
              editGrid(tb.id, e.shiftKey ? addRow(grid, y) : addCol(grid, x));
            }}
          />
        );
      })}
      {g ? (
        <>
          {g.headerRows > 0 ? (
            <div
              className="table-header-band"
              aria-hidden="true"
              style={pxStyle(
                px(
                  view(f, [
                    g.cols[0] ?? 0,
                    g.rows[g.headerRows] ?? 0,
                    g.cols.at(-1) ?? 0,
                    g.rows[0] ?? 0,
                  ]),
                  scale,
                ),
              )}
            />
          ) : null}
          {g.merges.map((m) => {
            const [x0, , , y1] = cellBox(g, m.r, m.c);
            const [, y0, x1] = cellBox(g, m.r + m.rs - 1, m.c + m.cs - 1);
            return (
              <div
                key={`${String(m.r)}:${String(m.c)}`}
                className="table-merge"
                aria-hidden="true"
                style={pxStyle(px(view(f, [x0, y0, x1, y1]), scale))}
              />
            );
          })}
          {g.cols.map((x, k) => (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- WAI-ARIA window splitter
            <div
              key={`c${String(k)}`}
              role="separator"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a splitter is focusable
              tabIndex={0}
              data-table-divider="col"
              className="table-divider table-divider--col"
              aria-orientation="vertical"
              aria-label={t('tables.review.colDivider', {
                n: format.number(k + 1, 0),
                count: g.cols.length,
              })}
              aria-valuenow={Math.round(x - f.originX)}
              aria-valuemin={Math.round((g.cols[k - 1] ?? f.originX) - f.originX)}
              aria-valuemax={Math.round((g.cols[k + 1] ?? f.originX + 10_000) - f.originX)}
              style={{
                left: (x - f.originX) * scale - colHit / 2,
                width: colHit,
                top: (f.originY + f.height - (g.rows[0] ?? 0)) * scale,
                height: ((g.rows[0] ?? 0) - (g.rows.at(-1) ?? 0)) * scale,
              }}
              onPointerDown={(e) => {
                startDividerDrag(e, 'col', k);
              }}
              onKeyDown={(e) => {
                dividerKey(e, 'col', k);
              }}
            />
          ))}
          {g.rows.map((y, k) => (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- WAI-ARIA window splitter
            <div
              key={`r${String(k)}`}
              role="separator"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a splitter is focusable
              tabIndex={0}
              data-table-divider="row"
              className="table-divider table-divider--row"
              aria-orientation="horizontal"
              aria-label={t('tables.review.rowDivider', {
                n: format.number(k + 1, 0),
                count: g.rows.length,
              })}
              aria-valuenow={Math.round(f.originY + f.height - y)}
              aria-valuemin={Math.round(
                f.originY + f.height - (g.rows[k - 1] ?? f.originY + f.height),
              )}
              aria-valuemax={Math.round(
                f.originY + f.height - (g.rows[k + 1] ?? f.originY - 10_000),
              )}
              style={{
                top: (f.originY + f.height - y) * scale - rowHit / 2,
                height: rowHit,
                left: ((g.cols[0] ?? 0) - f.originX) * scale,
                width: ((g.cols.at(-1) ?? 0) - (g.cols[0] ?? 0)) * scale,
              }}
              onPointerDown={(e) => {
                startDividerDrag(e, 'row', k);
              }}
              onKeyDown={(e) => {
                dividerKey(e, 'row', k);
              }}
            />
          ))}
        </>
      ) : null}
      <div ref={draft} className="table-outline table-outline--draft" aria-hidden="true" />
      {keyRect ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keyboard rectangle (M4-Q10)
        <div
          ref={keyEl}
          role="application"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard rectangle (M4-Q10)
          tabIndex={0}
          className="table-outline table-outline--key"
          aria-label={t('tables.review.keyRect')}
          aria-describedby={`table-keyrect-help-${String(pageIndex)}`}
          style={pxStyle(px(view(f, keyRect), scale))}
          onKeyDown={keyRectKey}
        >
          <span id={`table-keyrect-help-${String(pageIndex)}`} className="ui-visually-hidden">
            {t('tables.review.keyRectHelp')}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function pxStyle(r: { left: number; top: number; width: number; height: number }) {
  return {
    left: `${String(r.left)}px`,
    top: `${String(r.top)}px`,
    width: `${String(r.width)}px`,
    height: `${String(r.height)}px`,
  };
}
