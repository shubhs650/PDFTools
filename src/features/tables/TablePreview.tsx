import * as Menu from '@radix-ui/react-dropdown-menu';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import {
  anchorOf,
  colCount,
  merge,
  mergeAt,
  rowCount,
  setHeaderRows,
  unmerge,
  type TableGrid,
} from '../../model/tableGrid';
import { editGrid, useReview } from './reviewStore';

type Cell = [number, number];

/**
 * The selected table's cells as read from the page (M4-14): a grid to select
 * cells in (click, Shift+click, arrows, Shift+arrows) and set header rows and
 * merged cells from the keyboard (H, M, U) or the context menu (right click,
 * Shift+F10, the Menu key). Text comes from the Work worker; while a newer
 * grid is being read the old text stays (aria-busy).
 */
export function TablePreview({ id, grid }: { id: string; grid: TableGrid }) {
  const { t } = useTranslation();
  const preview = useReview((s) => (s.preview?.id === id ? s.preview : null));
  const [anchorAt, setAnchor] = useState<Cell>([0, 0]);
  const [focusAt, setFocus] = useState<Cell>([0, 0]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLTableElement>(null);
  const nr = rowCount(grid);
  const nc = colCount(grid);
  const current = preview?.key === JSON.stringify(grid);
  const cells = preview?.data.cells;
  const sameShape = cells?.length === nr && (cells[0]?.length ?? 0) === nc;

  // The selection stays inside the grid when dividers are removed.
  const clamp = ([r, c]: Cell): Cell => anchorOf(grid, Math.min(r, nr - 1), Math.min(c, nc - 1));
  const anchor = clamp(anchorAt);
  const focus = clamp(focusAt);

  const [r0, r1] = [Math.min(anchor[0], focus[0]), Math.max(anchor[0], focus[0])];
  const [c0, c1] = [Math.min(anchor[1], focus[1]), Math.max(anchor[1], focus[1])];
  const selected = (r: number, c: number) => r >= r0 && r <= r1 && c >= c0 && c <= c1;
  const multi = r1 > r0 || c1 > c0;
  const merged = mergeAt(grid, focus[0], focus[1]);

  const ops = {
    merge: () => {
      if (multi) editGrid(id, merge(grid, r0, c0, r1, c1));
    },
    unmerge: () => {
      if (merged) editGrid(id, unmerge(grid, focus[0], focus[1]));
    },
    header: () => {
      editGrid(id, setHeaderRows(grid, r1 + 1));
    },
    noHeader: () => {
      editGrid(id, setHeaderRows(grid, 0));
    },
  };

  const items: { id: keyof typeof ops; label: string; disabled: boolean }[] = [
    { id: 'merge', label: t('tables.review.menu.merge'), disabled: !multi },
    { id: 'unmerge', label: t('tables.review.menu.unmerge'), disabled: !merged },
    {
      id: 'header',
      label: t('tables.review.menu.header', { count: r1 + 1, n: format.number(r1 + 1, 0) }),
      disabled: false,
    },
    { id: 'noHeader', label: t('tables.review.menu.noHeader'), disabled: grid.headerRows === 0 },
  ];

  const focusCell = (cell: Cell, extend: boolean) => {
    const [ar, ac] = anchorOf(grid, cell[0], cell[1]);
    setFocus([ar, ac]);
    if (!extend) setAnchor([ar, ac]);
    requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLElement>(`[data-cell="${String(ar)}:${String(ac)}"]`)
        ?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const [r, c] = focus;
    const m = mergeAt(grid, r, c);
    const moves: Record<string, Cell> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [m ? m.r + m.rs : r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, m ? m.c + m.cs : c + 1],
      Home: [r, 0],
      End: [r, nc - 1],
    };
    const to = moves[e.key];
    if (to) {
      if (to[0] >= 0 && to[0] < nr && to[1] >= 0 && to[1] < nc) focusCell(to, e.shiftKey);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const el = (e.target as HTMLElement).getBoundingClientRect();
      setMenu({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
    } else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (e.key === 'm' || e.key === 'M') ops.merge();
    else if (e.key === 'u' || e.key === 'U') ops.unmerge();
    else if (e.key === 'h' || e.key === 'H') ops.header();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const rows = [];
  for (let r = 0; r < nr; r++) {
    const tds = [];
    for (let c = 0; c < nc; c++) {
      const [ar, ac] = anchorOf(grid, r, c);
      if (ar !== r || ac !== c) continue;
      const mg = mergeAt(grid, r, c);
      const text = sameShape ? (cells[r]?.[c] ?? '') : '';
      const isFocus = focus[0] === r && focus[1] === c;
      tds.push(
        <td
          key={c}
          role="gridcell"
          data-cell={`${String(r)}:${String(c)}`}
          tabIndex={isFocus ? 0 : -1}
          rowSpan={mg?.rs}
          colSpan={mg?.cs}
          aria-selected={selected(r, c)}
          className={r < grid.headerRows ? 'table-preview-header' : undefined}
          onClick={(e) => {
            focusCell([r, c], e.shiftKey);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selected(r, c)) focusCell([r, c], false);
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {text}
        </td>,
      );
    }
    rows.push(
      <tr key={r} role="row">
        {tds}
      </tr>,
    );
  }

  return (
    <div className="table-preview-wrap">
      <p className="print-note" id={`${id}-preview-help`}>
        {t('tables.review.previewHelp')}
      </p>
      <table
        ref={root}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- a data grid (cell selection, keys)
        role="grid"
        className="table-preview"
        aria-label={t('tables.review.previewLabel', {
          rows: format.number(nr, 0),
          cols: format.number(nc, 0),
        })}
        aria-describedby={`${id}-preview-help`}
        aria-busy={!current}
        aria-multiselectable="true"
        onKeyDown={onKeyDown}
      >
        <tbody>{rows}</tbody>
      </table>
      {menu ? (
        <Menu.Root
          open
          modal
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          <Menu.Trigger asChild>
            <span
              aria-hidden="true"
              style={{ position: 'fixed', left: menu.x, top: menu.y, width: 1, height: 1 }}
            />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="ui-menu"
              align="start"
              aria-label={t('tables.review.menu.label')}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                focusCell(focus, false);
              }}
            >
              {items.map(({ id: key, label, disabled }) => (
                <Menu.Item
                  key={key}
                  className="ui-menu-item"
                  disabled={disabled}
                  onSelect={() => {
                    setMenu(null);
                    ops[key]();
                  }}
                >
                  {label}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      ) : null}
    </div>
  );
}
