import { useDocumentState } from '@embedpdf/core/react';
import { useContext, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../../i18n';
import type { HfBands } from '../../../model/compare/text/headers';
import { colourOf, type Mark, type MarkColours, type Side } from '../../../model/compare/textView';
import { TextMarks } from './marksContext';

const LINE_TITLE: Record<keyof HfBands, MessageKey> = {
  top: msg('compare.text.bands.line_top'),
  bottom: msg('compare.text.bands.line_bottom'),
};

/** Line width of struck-through and underlined marks (CSS px). */
const LINE = 1.5;
const FILL_OPACITY = { fill: 0.24, strike: 0.14, underline: 0.14, frame: 0 } as const;

/**
 * The marks of one page of Document A or B, by colour and shape (D-64, Q42):
 * drawn by the view over the page as displayed, never part of the document,
 * and never in the way of the pointer (the comment tools work underneath).
 */
export function MarkLayer({
  side,
  documentId,
  pageIndex,
  scale,
}: {
  side: Side;
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const ctx = useContext(TextMarks);
  const marks = ctx.marks[side].get(pageIndex);
  return (
    <>
      {marks?.length ? (
        <svg className="text-marks" aria-hidden="true" data-testid={`text-marks-${side}`}>
          {marks.map((m, i) => (
            <MarkShape
              key={i}
              mark={m}
              scale={scale}
              colours={ctx.colours}
              selected={m.entry === ctx.selected}
            />
          ))}
        </svg>
      ) : null}
      {ctx.bands ? (
        <BandLines
          side={side}
          documentId={documentId}
          pageIndex={pageIndex}
          scale={scale}
          bands={ctx.bands[side]}
        />
      ) : null}
    </>
  );
}

function MarkShape({
  mark: m,
  scale,
  colours,
  selected,
}: {
  mark: Mark;
  scale: number;
  colours: MarkColours;
  selected: boolean;
}) {
  const colour = colourOf(m.style, colours);
  const x = m.x0 * scale;
  const y = m.y0 * scale;
  const w = Math.max(1, (m.x1 - m.x0) * scale);
  const h = Math.max(1, (m.y1 - m.y0) * scale);
  return (
    <g data-style={m.style} data-shape={m.shape} data-entry={m.entry}>
      {m.shape === 'frame' ? (
        <rect
          x={x - 2}
          y={y - 2}
          width={w + 4}
          height={h + 4}
          fill="none"
          stroke={colour}
          strokeWidth={2}
        />
      ) : (
        <rect
          className="text-mark-fill"
          x={x}
          y={y}
          width={w}
          height={h}
          fill={colour}
          fillOpacity={FILL_OPACITY[m.shape]}
        />
      )}
      {m.shape === 'strike' ? (
        <line x1={x} x2={x + w} y1={y + h / 2} y2={y + h / 2} stroke={colour} strokeWidth={LINE} />
      ) : null}
      {m.shape === 'underline' ? (
        <line x1={x} x2={x + w} y1={y + h} y2={y + h} stroke={colour} strokeWidth={LINE} />
      ) : null}
      {selected ? (
        <rect
          className="text-mark-selected"
          x={x - 3}
          y={y - 3}
          width={w + 6}
          height={h + 6}
          fill="none"
          stroke={colour}
          strokeWidth={2}
          strokeDasharray="4 2"
        />
      ) : null}
    </g>
  );
}

/** The page's displayed height (pt): its size turned by its own rotation. */
function useDisplayedHeight(documentId: string, pageIndex: number): number | null {
  const doc = useDocumentState(documentId);
  const p = doc?.document?.pages[pageIndex];
  if (!p) return null;
  return p.rotation % 2 === 1 ? p.size.width : p.size.height;
}

/**
 * The header and footer lines while bands are drawn by hand: dragged on any
 * page, they apply to every page of that document (the bar's fields are the
 * keyboard path).
 */
function BandLines({
  side,
  documentId,
  pageIndex,
  scale,
  bands,
}: {
  side: Side;
  documentId: string;
  pageIndex: number;
  scale: number;
  bands: HfBands;
}) {
  const { t } = useTranslation();
  const ctx = useContext(TextMarks);
  const height = useDisplayedHeight(documentId, pageIndex);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ edge: keyof HfBands; id: number } | null>(null);
  if (height === null) return null;
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const r = box.current?.getBoundingClientRect();
    if (d?.id !== e.pointerId || !r) return;
    const y = (e.clientY - r.top) / scale;
    const pt = d.edge === 'top' ? y : height - y;
    ctx.setBand(side, d.edge, Math.min(height / 2, Math.max(0, pt)));
  };
  const line = (edge: keyof HfBands) => {
    const y = (edge === 'top' ? bands.top : height - bands.bottom) * scale;
    return (
      <div
        className="text-band-line"
        data-edge={edge}
        data-testid={`text-band-${side}-${edge}`}
        style={{ top: `${String(y)}px` }}
        title={t(LINE_TITLE[edge], { side: ctx.sideName(side) })}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { edge, id: e.pointerId };
        }}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
    );
  };
  return (
    <div ref={box} className="text-bands" aria-hidden="true">
      <div
        className="text-band-shade"
        style={{ top: 0, height: `${String(bands.top * scale)}px` }}
      />
      <div
        className="text-band-shade"
        style={{ bottom: 0, height: `${String(bands.bottom * scale)}px` }}
      />
      {line('top')}
      {line('bottom')}
    </div>
  );
}
