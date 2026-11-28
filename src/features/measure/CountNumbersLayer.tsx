// Same-size count numbers on the page (M14-07, D-75): while the view option is
// on, each count's number as a small label beside its symbol wherever the
// saved number is drawn smaller than that on screen (countNumbers.ts). An
// in-app overlay only, never written to the file; pointer-transparent and
// hidden from assistive tech (the count's own text says the same).
import { useMemo } from 'react';
import { DEFAULT_COUNT_SIZE, NUMBER_GAP } from '../../model/measureCount';
import { CAPTION_SIZE } from '../../model/measureMarkup';
import { useAnnotationMap } from '../annotate/comments/commentsStore';
import { countsOf } from './countGroups';
import { labelPx, useCountNumbers } from './countNumbers';
import { format } from '../../i18n';

export function CountNumbersLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const on = useCountNumbers();
  const px = labelPx(CAPTION_SIZE, scale);
  // Re-read whenever the document's annotations change.
  const byUid = useAnnotationMap(on && px !== null ? documentId : null);
  const labels = useMemo(() => {
    if (!byUid) return [];
    return countsOf(documentId, pageIndex).flatMap(({ annotation: a, meta }) => {
      const at = meta.pts?.[0];
      if (meta.hideN || !at) return [];
      const size = meta.size ?? DEFAULT_COUNT_SIZE;
      const o = a as unknown as { strokeColor?: unknown };
      return [
        {
          id: a.id,
          // The number alone: short, so close counts' labels stay apart; the side line is its group's colour.
          text: format.number(meta.n ?? 0, 0),
          // Its left edge where the saved number starts: beside the symbol.
          x: at.x + size / 2 + NUMBER_GAP,
          y: at.y,
          color: typeof o.strokeColor === 'string' ? o.strokeColor : undefined,
        },
      ];
    });
  }, [byUid, documentId, pageIndex]);
  if (!on || px === null || labels.length === 0) return null;
  return (
    <div className="count-numbers" aria-hidden="true" data-testid="count-numbers">
      {labels.map((l) => (
        <span
          key={l.id}
          className="count-number-label"
          data-testid="count-number-label"
          style={{ left: l.x * scale, top: l.y * scale, fontSize: px, borderColor: l.color }}
        >
          {l.text}
        </span>
      ))}
    </div>
  );
}
