// The comment marquee's rectangle on one page (M7-04, B7): the selection
// plugin's, in the focus colour (tokens, rules 11–12). Which comments it picks
// is commentSelection.ts's.
import { MarqueeSelection } from '@embedpdf/plugin-selection/react';

const BORDER = 'var(--color-focus)';
const FILL = 'color-mix(in srgb, var(--color-focus) 12%, transparent)';

export function CommentMarquee({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  return (
    <MarqueeSelection
      documentId={documentId}
      pageIndex={pageIndex}
      scale={scale}
      className="comment-marquee"
      background={FILL}
      borderColor={BORDER}
      borderStyle="dashed"
    />
  );
}
