// The summary table drawn over the page until the plugin has the markup's
// appearance image (M14-10, D-76): just placed or just changed, and while
// selected (the tiles leave a selected markup out). The same layout as the
// appearance the Render worker draws (model/measureSummary.ts), in the page's
// colours in every theme.
import type { PdfAnnotationObject } from '@embedpdf/models';
import {
  SUMMARY_PAD,
  SUMMARY_ROW,
  SUMMARY_SIZE,
  summaryLayout,
  summaryOf,
} from '../../../model/measureSummary';

/** The table's rows: from this session, or read back from the markup's text. */
function rowsOf(a: PdfAnnotationObject): string[][] {
  const own = summaryOf(a)?.rows;
  if (own?.length) return own;
  return (a.contents ?? '').split('\n').map((line) => line.split('\t'));
}

export function SummaryPreview({ annotation }: { annotation: PdfAnnotationObject }) {
  const rows = rowsOf(annotation);
  const { widths, width, height } = summaryLayout(rows);
  if (!width || !height) return null;
  const lefts = widths.map((_, c) => widths.slice(0, c).reduce((s, w) => s + w, 0));
  return (
    <svg
      className="measure-summary-preview"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      <rect className="measure-summary-paper" x={0} y={0} width={width} height={height} />
      <rect className="measure-summary-head" x={0} y={0} width={width} height={SUMMARY_ROW} />
      {rows.slice(1).map((_, i) => (
        <line
          key={`r${String(i)}`}
          className="measure-summary-grid"
          x1={0}
          x2={width}
          y1={SUMMARY_ROW * (i + 1)}
          y2={SUMMARY_ROW * (i + 1)}
        />
      ))}
      {lefts.slice(1).map((x) => (
        <line
          key={`c${String(x)}`}
          className="measure-summary-grid"
          x1={x}
          x2={x}
          y1={0}
          y2={height}
        />
      ))}
      <rect
        className="measure-summary-grid measure-summary-frame"
        x={0}
        y={0}
        width={width}
        height={height}
      />
      {rows.map((row, i) =>
        row.map((cell, c) => {
          // The first column and the head row read from the left; numbers line up on the right.
          const right = c > 0 && i > 0;
          const x = (lefts[c] ?? 0) + (right ? (widths[c] ?? 0) - SUMMARY_PAD : SUMMARY_PAD);
          return (
            <text
              key={`${String(i)}-${String(c)}`}
              className="measure-summary-text"
              x={x}
              y={SUMMARY_ROW * i + SUMMARY_ROW / 2}
              fontSize={SUMMARY_SIZE}
              textAnchor={right ? 'end' : 'start'}
              dominantBaseline="central"
            >
              {cell}
            </text>
          );
        }),
      )}
    </svg>
  );
}
