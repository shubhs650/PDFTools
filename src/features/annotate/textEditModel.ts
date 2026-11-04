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
