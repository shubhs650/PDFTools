import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cellName, colLetters } from '../../../model/crs/a1';
import type {
  PreviewCell,
  PreviewEdge,
  SheetPreview,
} from '../../../workers/work/crsTemplate/preview';

/** What a click on the preview sets: a row, a cell or a column (or nothing in step 4). */
export type PickMode = 'row' | 'cell' | 'column' | 'none';

export interface SheetPreviewGridProps {
  preview: SheetPreview;
  mode: PickMode;
  /** The grid's accessible name. */
  label: string;
  startRow: number;
  lastPreDrawn: number | null;
  /** Placed fields by column (names as shown). */
  columnMarks: ReadonlyMap<number, string[]>;
  /** Placed detail cells by "row:col" (names as shown). */
  detailMarks: ReadonlyMap<string, string[]>;
  /** Where the field being set is now: highlighted. */
  active: { row?: number; col?: number } | null;
  zoom: number;
  onPick: (row: number, col: number) => void;
}

const EDGE: Record<string, string> = {
  thin: '1px solid',
  hair: '1px dotted',
  dotted: '1px dotted',
  dashed: '1px dashed',
  dashDot: '1px dashed',
  dashDotDot: '1px dashed',
  medium: '2px solid',
  mediumDashed: '2px dashed',
  mediumDashDot: '2px dashed',
  mediumDashDotDot: '2px dashed',
  slantDashDot: '2px dashed',
  thick: '3px solid',
  double: '3px double',
};

const edge = (e: PreviewEdge | undefined): string | undefined =>
  e ? `${EDGE[e.style] ?? '1px solid'} ${e.color ?? 'var(--color-sheet-ink)'}` : undefined;

const key = (r: number, c: number): string => `${String(r)}:${String(c)}`;

/** Excel's default font size (pt) at 96 dpi, in px. */
const PT = 4 / 3;

/**
 * The CRS template set-up's live sheet preview (M13-08, D-71, C13): the
 * sheet's first rows as Excel draws them (merged cells, borders, fills,
 * fonts, column widths, row heights, where pictures sit), always on a white
 * sheet as a page is. A click on a cell places the field being set; the
 * arrow keys move through the cells and Enter or Space places (rule 12).
 * Placed fields, the start row and the pre-drawn rows are marked.
 */
export function SheetPreviewGrid(p: SheetPreviewGridProps) {
  const { t } = useTranslation();
  const { preview, zoom } = p;
  const byKey = useMemo(() => new Map(preview.cells.map((c) => [key(c.r, c.c), c])), [preview]);
  /** Every cell inside a merge → its first cell. */
  const masterOf = useMemo(() => {
    const m = new Map<string, PreviewCell>();
    for (const c of preview.cells) {
      if (!c.rs && !c.cs) continue;
      for (let r = c.r; r < c.r + (c.rs ?? 1); r++)
        for (let k = c.c; k < c.c + (c.cs ?? 1); k++) m.set(key(r, k), c);
    }
    return m;
  }, [preview]);
  const pictureAt = useMemo(() => {
    const s = new Set<string>();
    for (const g of preview.pictures) s.add(key(g.r1, g.c1));
    return s;
  }, [preview]);

  const [focus, setFocus] = useState<{ r: number; c: number }>(() => ({
    r: Math.min(preview.rows, Math.max(1, p.startRow || 1)),
    c: 1,
  }));
  const tableRef = useRef<HTMLTableElement>(null);
  const masterPos = (r: number, c: number) => {
    const m = masterOf.get(key(r, c));
    return m ? { r: m.r, c: m.c } : { r, c };
  };
  const at = masterPos(focus.r, focus.c);

  const moveTo = (r: number, c: number) => {
    const rr = Math.max(1, Math.min(preview.rows, r));
    const cc = Math.max(1, Math.min(preview.cols, c));
    const m = masterPos(rr, cc);
    setFocus({ r: rr, c: cc });
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${key(m.r, m.c)}"]`);
    el?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const cur = masterOf.get(key(focus.r, focus.c));
    const r1 = cur ? cur.r : focus.r;
    const c1 = cur ? cur.c : focus.c;
    const r2 = cur ? cur.r + (cur.rs ?? 1) - 1 : focus.r;
    const c2 = cur ? cur.c + (cur.cs ?? 1) - 1 : focus.c;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
        moveTo(focus.r, c2 + 1);
        break;
      case 'ArrowLeft':
        moveTo(focus.r, c1 - 1);
        break;
      case 'ArrowDown':
        moveTo(r2 + 1, focus.c);
        break;
      case 'ArrowUp':
        moveTo(r1 - 1, focus.c);
        break;
      case 'PageDown':
        moveTo(focus.r + 10, focus.c);
        break;
      case 'PageUp':
        moveTo(focus.r - 10, focus.c);
        break;
      case 'Home':
        moveTo(e.ctrlKey ? 1 : focus.r, 1);
        break;
      case 'End':
        moveTo(e.ctrlKey ? preview.rows : focus.r, preview.cols);
        break;
      case 'Enter':
      case ' ':
        if (p.mode !== 'none') p.onPick(at.r, at.c);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const last = p.lastPreDrawn ?? p.startRow;
  const fontPx = 11 * PT * zoom;
  const rows: number[] = [];
  for (let r = 1; r <= preview.rows; r++) rows.push(r);
  const cols: number[] = [];
  for (let c = 1; c <= preview.cols; c++) cols.push(c);
  const tableWidth = preview.colPx.reduce((a, b) => a + b, 0) * zoom + 40 * zoom;

  const rowClass = (r: number): string => {
    if (!p.startRow) return '';
    if (r === p.startRow) return 'crs-pv-start';
    if (r > p.startRow && r <= last) return 'crs-pv-predrawn';
    return '';
  };

  return (
    <table
      ref={tableRef}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- a data grid (cell picking, keys)
      role="grid"
      aria-label={p.label}
      aria-rowcount={preview.rows + 1}
      aria-colcount={preview.cols + 1}
      className={`crs-pv crs-pv--${p.mode}`}
      style={{ width: tableWidth, fontSize: fontPx }}
      onKeyDown={onKeyDown}
    >
      <colgroup>
        <col style={{ width: 40 * zoom }} />
        {preview.colPx.map((w, i) => (
          <col key={i} style={{ width: w * zoom }} />
        ))}
      </colgroup>
      <thead>
        <tr role="row" aria-rowindex={1}>
          <th className="crs-pv-corner" aria-hidden="true" />
          {cols.map((c) => {
            const marks = p.columnMarks.get(c);
            const active = p.active?.col === c && p.active.row === undefined;
            return (
              <th
                key={c}
                role="columnheader"
                aria-colindex={c + 1}
                className={[
                  'crs-pv-colhead',
                  marks ? 'crs-pv-colhead--placed' : '',
                  active ? 'crs-pv-colhead--active' : '',
                ].join(' ')}
                onClick={() => {
                  if (p.mode === 'column') p.onPick(p.startRow || 1, c);
                }}
              >
                {colLetters(c)}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r}
            role="row"
            aria-rowindex={r + 1}
            className={[rowClass(r), r === last && p.startRow ? 'crs-pv-last' : ''].join(' ')}
            style={{ height: (preview.rowPx[r - 1] ?? 20) * zoom }}
          >
            <th
              role="rowheader"
              className={[
                'crs-pv-rowhead',
                p.active?.row === r && p.active.col === undefined ? 'crs-pv-rowhead--active' : '',
              ].join(' ')}
              onClick={() => {
                if (p.mode === 'row') p.onPick(r, 1);
              }}
            >
              {r}
            </th>
            {cols.map((c) => {
              const k = key(r, c);
              const m = masterOf.get(k);
              if (m && (m.r !== r || m.c !== c)) return null;
              const cell = byKey.get(k);
              const fields = r === p.startRow ? p.columnMarks.get(c) : undefined;
              const details = p.detailMarks.get(k);
              const a = p.active;
              const isActive =
                a !== null &&
                ((a.row === r && a.col === c) ||
                  (a.row === undefined && a.col === c && r === p.startRow));
              const focused = at.r === r && at.c === c;
              return (
                <PreviewTd
                  key={c}
                  r={r}
                  c={c}
                  cell={cell}
                  zoom={zoom}
                  picture={pictureAt.has(k)}
                  fields={fields}
                  details={details}
                  active={isActive}
                  tabIndex={focused ? 0 : -1}
                  pictureLabel={t('crs.setup.picture')}
                  formulaMark={t('crs.setup.formulaMark')}
                  onFocus={() => {
                    if (!focused) setFocus({ r, c });
                  }}
                  onPick={() => {
                    setFocus({ r, c });
                    if (p.mode !== 'none') p.onPick(r, c);
                  }}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PreviewTd(props: {
  r: number;
  c: number;
  cell: PreviewCell | undefined;
  zoom: number;
  picture: boolean;
  fields: string[] | undefined;
  details: string[] | undefined;
  active: boolean;
  tabIndex: number;
  pictureLabel: string;
  formulaMark: string;
  onFocus: () => void;
  onPick: () => void;
}) {
  const { cell, zoom } = props;
  const style: CSSProperties = {};
  if (cell?.fill) style.backgroundColor = cell.fill;
  if (cell?.color) style.color = cell.color;
  if (cell?.bold) style.fontWeight = 700;
  if (cell?.italic) style.fontStyle = 'italic';
  if (cell?.underline) style.textDecoration = 'underline';
  if (cell?.size) style.fontSize = cell.size * PT * zoom;
  if (cell?.h) style.textAlign = cell.h;
  if (cell?.v) style.verticalAlign = cell.v;
  if (cell?.wrap) style.whiteSpace = 'pre-wrap';
  const top = edge(cell?.top);
  const right = edge(cell?.right);
  const bottom = edge(cell?.bottom);
  const left = edge(cell?.left);
  if (top) style.borderTop = top;
  if (right) style.borderRight = right;
  if (bottom) style.borderBottom = bottom;
  if (left) style.borderLeft = left;
  const addr = cellName(props.c, props.r);
  const marks = [...(props.fields ?? []), ...(props.details ?? [])];
  const text = cell?.text ?? '';
  const name = [addr, text, ...marks].filter(Boolean).join(', ');
  return (
    <td
      role="gridcell"
      data-cell={key(props.r, props.c)}
      aria-colindex={props.c + 1}
      aria-label={name}
      aria-selected={props.active}
      tabIndex={props.tabIndex}
      rowSpan={cell?.rs ?? 1}
      colSpan={cell?.cs ?? 1}
      className={[
        'crs-pv-cell',
        cell?.wrap ? 'crs-pv-cell--wrap' : '',
        props.active ? 'crs-pv-cell--active' : '',
        marks.length ? 'crs-pv-cell--marked' : '',
      ].join(' ')}
      style={style}
      onFocus={props.onFocus}
      onClick={props.onPick}
    >
      {props.picture ? <span className="crs-pv-picture">{props.pictureLabel}</span> : null}
      {text ? <span className="crs-pv-text">{text}</span> : null}
      {cell?.formula && !text ? (
        <span className="crs-pv-formula" aria-hidden="true">
          {props.formulaMark}
        </span>
      ) : null}
      {marks.length ? (
        <span className="crs-pv-marks" aria-hidden="true">
          {(props.fields ?? []).map((f) => (
            <span key={`f-${f}`} className="crs-pv-chip crs-pv-chip--field" title={f}>
              {f}
            </span>
          ))}
          {(props.details ?? []).map((f) => (
            <span key={`d-${f}`} className="crs-pv-chip crs-pv-chip--detail" title={f}>
              {f}
            </span>
          ))}
        </span>
      ) : null}
    </td>
  );
}
