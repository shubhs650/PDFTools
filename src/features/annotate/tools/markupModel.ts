// Text markups from a text selection (M3-08, D-03, rule 6): one standard
// annotation per page — Highlight, Underline, StrikeOut or Squiggly with a
// quad per selected line (EmbedPDF writes /QuadPoints from the segment rects
// and PDFium the appearance, B7) — or a Caret for inserted text, and a Caret
// grouped with a StrikeOut (/IRT + /RT /Group) for replaced text, as Acrobat
// and PDF-XChange make them. Pure: the plugin and the selection are wired in
// textMarkup.ts.
import {
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  PdfBlendMode,
  type PdfAnnotationObject,
  type Rect,
} from '@embedpdf/models';

export const MARKUP_TOOLS = [
  'highlight',
  'underline',
  'strikeout',
  'squiggly',
  'insertText',
  'replaceText',
] as const;

/** A text markup tool; the id is also the plugin's tool id and interaction mode. */
export type MarkupTool = (typeof MARKUP_TOOLS)[number];

export const isMarkupTool = (t: string): t is MarkupTool =>
  (MARKUP_TOOLS as readonly string[]).includes(t);

/** Our defaults (colors, opacity), not EmbedPDF's; the Properties pane changes them (M3-10). */
export const MARKUP_DEFAULTS: Record<MarkupTool, { color: string; opacity: number }> = {
  highlight: { color: '#FFE14D', opacity: 1 },
  underline: { color: '#1E6FD9', opacity: 1 },
  strikeout: { color: '#D93025', opacity: 1 },
  squiggly: { color: '#1E8E3E', opacity: 1 },
  insertText: { color: '#1E6FD9', opacity: 1 },
  replaceText: { color: '#D93025', opacity: 1 },
};

const SUBTYPE = {
  highlight: PdfAnnotationSubtype.HIGHLIGHT,
  underline: PdfAnnotationSubtype.UNDERLINE,
  strikeout: PdfAnnotationSubtype.STRIKEOUT,
  squiggly: PdfAnnotationSubtype.SQUIGGLY,
} as const;

/** One page of a text selection, as the selection plugin formats it (top-left page points). */
export interface PageSelection {
  pageIndex: number;
  rect: Rect;
  /** One rect per selected line segment. */
  segmentRects: Rect[];
}

/**
 * The caret mark at the end of the selection's last segment: as wide as half
 * the line is high, standing on the baseline area at the insertion point.
 */
export function caretRect(lastSeg: Rect): Rect {
  const h = lastSeg.size.height / 2;
  return {
    origin: { x: lastSeg.origin.x + lastSeg.size.width - h / 2, y: lastSeg.origin.y + h },
    size: { width: h, height: h },
  };
}

export interface BuildOptions {
  now: Date;
  newId: () => string;
  /**
   * The selected text of each page in `selections` order, or null when the
   * document denies copying (rule 9): the markups are made without it.
   */
  texts: readonly string[] | null;
  /** The tool's current style (the highlight's palette, M6-07); else MARKUP_DEFAULTS. */
  style?: { color: string; opacity: number } | undefined;
}

/**
 * The annotations a tool makes from a selection, in creation order (a
 * replacement's Caret before the StrikeOut that points at it). The id to
 * select afterwards is the first of each page.
 */
export function buildMarkups(
  tool: MarkupTool,
  selections: readonly PageSelection[],
  opts: BuildOptions,
): PdfAnnotationObject[] {
  const { color, opacity } = opts.style ?? MARKUP_DEFAULTS[tool];
  const out: PdfAnnotationObject[] = [];
  selections.forEach((sel, i) => {
    const last = sel.segmentRects.at(-1);
    if (!last) return;
    const trimmed = opts.texts?.[i]?.trim() ?? '';
    const text = trimmed === '' ? undefined : trimmed;
    const base = {
      pageIndex: sel.pageIndex,
      created: opts.now,
      modified: opts.now,
      flags: ['print' as const],
      opacity,
    };
    if (tool === 'insertText' || tool === 'replaceText') {
      const caretId = opts.newId();
      out.push({
        ...base,
        type: PdfAnnotationSubtype.CARET,
        id: caretId,
        rect: caretRect(last),
        strokeColor: color,
        intent: tool === 'insertText' ? 'Insert' : 'Replace',
        rectangleDifferences: { left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 },
      });
      if (tool === 'replaceText')
        out.push({
          ...base,
          type: PdfAnnotationSubtype.STRIKEOUT,
          id: opts.newId(),
          rect: sel.rect,
          segmentRects: sel.segmentRects,
          strokeColor: color,
          color,
          intent: 'StrikeOutTextEdit',
          inReplyToId: caretId,
          replyType: PdfAnnotationReplyType.Group,
          ...(text ? { contents: text } : {}),
        });
      return;
    }
    out.push({
      ...base,
      type: SUBTYPE[tool],
      id: opts.newId(),
      rect: sel.rect,
      segmentRects: sel.segmentRects,
      strokeColor: color,
      color,
      ...(tool === 'highlight' ? { blendMode: PdfBlendMode.Multiply } : {}),
      ...(text ? { contents: text } : {}),
    });
  });
  return out;
}

/**
 * The selected text per page, from the selection plugin's lines (one entry
 * per page that has selected characters, in page order): matched to the
 * formatted selection's pages when the counts agree, else the whole text on
 * each page.
 */
export function textsPerPage(
  selections: readonly PageSelection[],
  pages: readonly string[] | undefined,
): string[] | null {
  if (!pages) return null;
  if (pages.length === selections.length) return [...pages];
  const all = pages.join('\n');
  return selections.map(() => all);
}
