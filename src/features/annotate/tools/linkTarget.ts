// Where a new link goes (M3-09): a page of this document or a web address.
// Pure: the dialog's input → the PDF link target, with validation.
import { PdfActionType, PdfZoomMode, type PdfLinkTarget } from '@embedpdf/models';

export type LinkInput = { kind: 'page'; page: string } | { kind: 'url'; url: string };
export type LinkError = 'pageRange' | 'url';

/** Schemes a link may point to; anything else (javascript:, file:, data:) is refused. */
const SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** A URL typed without a scheme gets https://, as browsers' address bars do. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/u.test(s)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/iu.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!SCHEMES.has(u.protocol)) return null;
    if (u.protocol !== 'mailto:' && !u.hostname.includes('.') && u.hostname !== 'localhost')
      return null;
    return u.href;
  } catch {
    return null;
  }
}

export function linkTarget(
  input: LinkInput,
  pageCount: number,
): { target: PdfLinkTarget; error: null } | { target: null; error: LinkError } {
  if (input.kind === 'page') {
    const n = Number(input.page.trim());
    if (!Number.isInteger(n) || n < 1 || n > pageCount) return { target: null, error: 'pageRange' };
    return {
      target: {
        type: 'action',
        action: {
          type: PdfActionType.Goto,
          destination: { pageIndex: n - 1, zoom: { mode: PdfZoomMode.FitPage }, view: [] },
        },
      },
      error: null,
    };
  }
  const uri = normalizeUrl(input.url);
  if (!uri) return { target: null, error: 'url' };
  return { target: { type: 'action', action: { type: PdfActionType.URI, uri } }, error: null };
}
