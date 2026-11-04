// What a text comment's editor writes (M7-02, ADR-023 D-43 d); textEdit.ts does the writing.

/**
 * The text an editor holds, as /Contents: no-break spaces (which the browser
 * types for a run of spaces) are spaces, and an emptied editor's lone line
 * break is no text.
 */
export function editorText(raw: string): string {
  const text = raw.replace(/\u00A0/g, ' ');
  return text === '\n' ? '' : text;
}

/** What a commit writes: the patch, or null when the text did not change. */
export function contentsPatch(
  current: string | undefined,
  raw: string,
): { contents: string } | null {
  const text = editorText(raw);
  return text === (current ?? '') ? null : { contents: text };
}

/** How far (screen px) a press on a text comment must travel to become a move (M7-03). */
export const MOVE_THRESHOLD_PX = 3;

/**
 * A pointer movement on screen as a movement in page points (M7-03): the
 * view's scale and the page's rotation (quarter turns) undone, as the
 * annotation plugin's own drag does.
 */
export function pageDelta(
  dx: number,
  dy: number,
  scale: number,
  rotation: number,
): { x: number; y: number } {
  const turns = ((Math.round(rotation) % 4) + 4) % 4;
  const x = dx / scale;
  const y = dy / scale;
  switch (turns) {
    case 1:
      return { x: y, y: -x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: -y, y: x };
    default:
      return { x, y };
  }
}
