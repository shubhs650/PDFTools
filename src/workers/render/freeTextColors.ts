// A text comment's text and border colours on the Render side (ADR-024,
// spike S25, §7.1). EmbedPDF writes the border colour into /DA and the text
// colour into its private /TextColor, but PDFium's appearance draws the text
// in /DA's colour too, so a blue text on a red border showed red everywhere
// but in the editor. After EmbedPDF has created or updated a FreeText and
// PDFium has generated its appearance, this:
//   - writes /DS (font, size, alignment and `color:` the text colour), where
//     Acrobat and PDF-XChange read the text colour;
//   - when the comment has a border of another colour, changes only the
//     fill colour operator inside the appearance's `BT … ET` blocks to the
//     text colour, and sets that back as the appearance;
//   - otherwise clears a stale /TextColor (the reader would prefer it).
// The appearance is PDFium's own, exported as a one-page document
// (EPDFAnnot_ExportAppearanceAsDocument), its form XObject replaced by an
// incremental update with the recoloured content, and set back through
// EPDFAnnot_SetAppearanceFromPage, which carries the page's resources (the
// fonts PDFium used) when the page draws it as the form `/EPDFWRAP` (M7-12). Layout, wrapping, fonts, alignment and the border stay
// PDFium's. If the appearance is not what we expect, PDFium's stays and a
// count is kept for the next save's diagnostics event (never shown).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationColorType, PdfAnnotationSubtype } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { unzlibSync } from 'fflate';
import {
  isDict,
  nameOf,
  numOf,
  Parser,
  PdfName,
  PdfRef,
  serialize,
  type PdfDict,
  type PdfValue,
} from '../../model/pdf/objects';
import { defaultStyleString, normalizeHex, recolorText } from '../../model/freeTextStyle';
import { acquirePage, rawCall, withWideString } from './pdfium';
import { concatBytes, encodeLatin1, latin1 } from './save/bytes';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from './save/writer';
import {
  lastStartxref,
  newestTrailerDict,
  trailerRef,
  trailerSize,
  writeXrefSection,
} from './save/xref';

interface FreeTextArg {
  id?: unknown;
  type?: unknown;
  intent?: unknown;
  calloutLine?: unknown;
  fontColor?: unknown;
  strokeColor?: unknown;
  strokeWidth?: unknown;
  fontFamily?: unknown;
  fontSize?: unknown;
  textAlign?: unknown;
  contents?: unknown;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
}

export type TextColorOutcome = 'none' | 'style' | 'recolored' | 'fallback';

const fallbacks = new Map<string, number>();

/** Appearances kept as PDFium made them since the last call, for a diagnostics event. */
export function takeTextColorFallbacks(docId: string): number {
  const n = fallbacks.get(docId) ?? 0;
  fallbacks.delete(docId);
  return n;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** The comment's border colour, when it draws a border (a text box with a width, or a callout). */
function borderOf(a: FreeTextArg): string | null {
  const stroke = str(a.strokeColor);
  if (!stroke || stroke === 'transparent') return null;
  const callout =
    a.intent === 'FreeTextCallout' || (Array.isArray(a.calloutLine) && a.calloutLine.length > 0);
  if (!callout && !((num(a.strokeWidth) ?? 0) > 0)) return null;
  return normalizeHex(stroke);
}

/**
 * After the executor's FreeText create or update: the /DS string, and the
 * text colour in the appearance. A move without a new appearance is left alone.
 */
export function applyTextColors(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: readonly unknown[],
): TextColorOutcome {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return 'none';
  const annot = args[2] as FreeTextArg | undefined;
  if (annot?.type !== PdfAnnotationSubtype.FREETEXT || typeof annot.id !== 'string') return 'none';
  const opts = args[3] as { regenerateAppearance?: unknown } | undefined;
  if (method === 'updatePageAnnotation' && opts?.regenerateAppearance === false) return 'none';
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const pageIndex = (args[1] as { index?: unknown } | undefined)?.index;
  if (typeof docId !== 'string' || typeof pageIndex !== 'number') return 'none';
  const text = normalizeHex(str(annot.fontColor) ?? '') ?? '#000000';
  const border = borderOf(annot);
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const a = withWideString(mod, annot.id, (p) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, p),
    );
    if (!a) return 'none';
    try {
      const ds = defaultStyleString({
        fontFamily: num(annot.fontFamily),
        fontSize: num(annot.fontSize),
        textAlign: num(annot.textAlign),
        color: text,
      });
      withWideString(mod, ds, (p) => rawCall(mod, 'FPDFAnnot_SetStringValue', a, 'DS', p));
      if (!border || border === text) {
        // One colour: /DA has it. A /TextColor left by an earlier two-colour state would win on read.
        rawCall(mod, 'EPDFAnnot_ClearColor', a, PdfAnnotationColorType.TextColor);
        return 'style';
      }
      const outcome = recolorAppearance(mod, a, text);
      if (outcome === 'fallback' || (outcome === 'no-text' && str(annot.contents)?.trim())) {
        fallbacks.set(docId, (fallbacks.get(docId) ?? 0) + 1);
        return 'fallback';
      }
      return outcome === 'recolored' ? 'recolored' : 'style';
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}

type RecolorOutcome = 'recolored' | 'unchanged' | 'no-text' | 'fallback';

/** PDFium's appearance of `annot` with its text in `hex`, set back as its appearance. */
function recolorAppearance(mod: WrappedPdfiumModule, annot: number, hex: string): RecolorOutcome {
  const exported = rawCall(mod, 'EPDFAnnot_ExportAppearanceAsDocument', annot);
  if (!exported) return 'fallback';
  let bytes: Uint8Array;
  try {
    bytes = saveWithFlags(mod, exported, FPDF_NO_INCREMENTAL);
  } catch {
    return 'fallback';
  } finally {
    rawCall(mod, 'FPDF_CloseDocument', exported);
  }
  let file: Uint8Array;
  try {
    const ex = readExport(bytes);
    if (!ex) return 'fallback';
    const r = recolorText(latin1(ex.data), hex);
    if (!r.ok) return r.reason === 'no-text' ? 'no-text' : 'fallback';
    if (!r.changed) return 'unchanged';
    file = pageDrawing(bytes, ex, encodeLatin1(r.content));
  } catch {
    return 'fallback';
  }
  const heap = mod.pdfium as unknown as Heap;
  const ptr = heap.wasmExports.malloc(file.length);
  try {
    heap.HEAPU8.set(file, ptr);
    const tmp = rawCall(mod, 'FPDF_LoadMemDocument', ptr, file.length, '');
    if (!tmp) return 'fallback';
    try {
      return rawCall(mod, 'EPDFAnnot_SetAppearanceFromPage', annot, tmp, 0)
        ? 'recolored'
        : 'fallback';
    } finally {
      rawCall(mod, 'FPDF_CloseDocument', tmp);
    }
  } finally {
    heap.wasmExports.free(ptr);
  }
}

// ------------------------------------------------------------ the exported document

interface Exported {
  /** The page object (number, generation, dictionary). */
  page: { num: number; gen: number; dict: PdfDict };
  /** The appearance form's /Resources, /BBox and /Matrix. */
  resources: PdfValue;
  bbox: [number, number, number, number];
  matrix: number[];
  /** The appearance's decoded content. */
  data: Uint8Array;
}

/** Object offsets from a classic xref table (PDFium's own one-page export). */
function xrefTable(bytes: Uint8Array): Map<number, [number, number]> {
  const at = lastStartxref(bytes);
  const text = latin1(bytes.subarray(at, bytes.length));
  if (!text.startsWith('xref')) throw new Error('not a classic xref');
  const body = text.slice(4, text.indexOf('trailer'));
  const out = new Map<number, [number, number]>();
  let next = 0;
  for (const raw of body.split(/\r\n|\r|\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^(\d+)\s+(\d+)$/u.exec(line);
    if (head) {
      next = Number(head[1]);
      continue;
    }
    const e = /^(\d{10})\s+(\d{5})\s+([nf])$/u.exec(line);
    if (!e) throw new Error('bad xref entry');
    if (e[3] === 'n') out.set(next, [Number(e[1]), Number(e[2])]);
    next++;
  }
  return out;
}

const numbers = (v: PdfValue | undefined, n: number): number[] | null =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number') ? v : null;

/** PDFium's export: its one page, which draws the appearance form with `Do`. */
function readExport(bytes: Uint8Array): Exported | null {
  const xref = xrefTable(bytes);
  const objAt = (n: number): { value: PdfValue; parser: Parser; gen: number } | null => {
    const e = xref.get(n);
    if (!e) return null;
    const p = new Parser(bytes, e[0]);
    p.parse();
    p.parse();
    p.expectKeyword('obj');
    return { value: p.parse(), parser: p, gen: e[1] };
  };
  const resolve = (v: PdfValue | undefined): PdfValue | undefined =>
    v instanceof PdfRef ? objAt(v.num)?.value : v;
  const rootRef = trailerRef(newestTrailerDict(bytes), 'Root');
  const rootNum = rootRef ? Number(/^(\d+)/u.exec(rootRef)?.[1]) : NaN;
  const root = Number.isFinite(rootNum) ? objAt(rootNum)?.value : undefined;
  if (!isDict(root)) return null;
  const pages = resolve(root.get('Pages'));
  if (!isDict(pages)) return null;
  const kids = resolve(pages.get('Kids'));
  const pageRef = Array.isArray(kids) && kids.length === 1 ? kids[0] : undefined;
  if (!(pageRef instanceof PdfRef)) return null;
  const pageObj = objAt(pageRef.num);
  if (!pageObj || !isDict(pageObj.value)) return null;
  const res = resolve(pageObj.value.get('Resources'));
  const xobjects = isDict(res) ? resolve(res.get('XObject')) : undefined;
  if (!isDict(xobjects) || xobjects.size !== 1) return null;
  const formRef = [...xobjects.values()][0];
  if (!(formRef instanceof PdfRef)) return null;
  const obj = objAt(formRef.num);
  if (!obj || !isDict(obj.value) || nameOf(obj.value.get('Subtype')) !== 'Form') return null;
  const dict = obj.value;
  const bbox = numbers(resolve(dict.get('BBox')), 4);
  const matrix = dict.has('Matrix') ? numbers(resolve(dict.get('Matrix')), 6) : [1, 0, 0, 1, 0, 0];
  const length = numOf(resolve(dict.get('Length')));
  if (!bbox || !matrix || length === undefined) return null;
  const stream = obj.parser.streamAfter(dict, length);
  if (!stream) return null;
  const filter = dict.get('Filter');
  const filterName =
    Array.isArray(filter) && filter.length === 1 ? nameOf(filter[0]) : nameOf(filter);
  if ((filter !== undefined && filterName !== 'FlateDecode') || dict.has('DecodeParms'))
    return null;
  return {
    page: { num: pageRef.num, gen: pageObj.gen, dict: pageObj.value },
    resources: dict.get('Resources') ?? new Map(),
    bbox: [bbox[0] ?? 0, bbox[1] ?? 0, bbox[2] ?? 0, bbox[3] ?? 0],
    matrix,
    data: filter === undefined ? stream.raw : unzlibSync(stream.raw),
  };
}

/**
 * What EPDFAnnot_SetAppearanceFromPage makes of a page (spike S25, M7-12):
 * the appearance's content is a copy of the page's content, but its
 * /Resources hold only `/XObject << /EPDFWRAP … >>`, a form copied from the
 * page with the page's resources. So the page's content must use that one
 * name and nothing else: it draws the recoloured appearance as a form XObject
 * called EPDFWRAP. In the appearance that name finds the copied page, whose
 * own EPDFWRAP is the recoloured form, with its fonts and graphics states.
 * (A page that draws the content inline, M7's first version, rendered in
 * PDFium only because it falls back to stock fonts; Acrobat, poppler and
 * pdf.js found no /Helv or /GS. A form under another name drew nothing.)
 */
const WRAP_NAME = 'EPDFWRAP';

/**
 * `bytes` with an incremental update: the page draws `content` as the form
 * XObject `/EPDFWRAP` (the appearance form's /BBox and /Resources), placed as
 * the export placed PDFium's form. The page's content is the bare `Do` (the
 * appearance runs it twice, once in its own content and once in the copied
 * page), so the placement is all in the form's /Matrix: PDFium's matrix,
 * then the move of the box's corner to the origin.
 */
function pageDrawing(bytes: Uint8Array, ex: Exported, content: Uint8Array): Uint8Array {
  const [x0, y0, x1, y1] = ex.bbox;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = ex.matrix;
  const matrix = [a, b, c, d, e - Math.min(x0, x1), f - Math.min(y0, y1)].map(
    (v) => Math.round(v * 10000) / 10000,
  );
  const pageContent = encodeLatin1(`/${WRAP_NAME} Do\n`);
  const size = trailerSize(bytes);
  const contentNum = size;
  const formNum = size + 1;
  const page: PdfDict = new Map(ex.page.dict);
  page.set('Resources', new Map([['XObject', new Map([[WRAP_NAME, new PdfRef(formNum, 0)]])]]));
  page.set('Contents', new PdfRef(contentNum, 0));
  const form: PdfDict = new Map<string, PdfValue>([
    ['Type', new PdfName('XObject')],
    ['Subtype', new PdfName('Form')],
    ['BBox', [...ex.bbox]],
    ['Matrix', matrix],
    ['Resources', ex.resources],
    ['Length', content.length],
  ]);
  const eol = bytes[bytes.length - 1] === 0x0a || bytes[bytes.length - 1] === 0x0d ? '' : '\n';
  const pageObj = encodeLatin1(
    `${eol}${String(ex.page.num)} ${String(ex.page.gen)} obj\n${serialize(page)}\nendobj\n`,
  );
  const contentObj = concatBytes([
    encodeLatin1(
      `${String(contentNum)} 0 obj\n<< /Length ${String(pageContent.length)} >>\nstream\n`,
    ),
    pageContent,
    encodeLatin1('\nendstream\nendobj\n'),
  ]);
  const formObj = concatBytes([
    encodeLatin1(`${String(formNum)} 0 obj\n${serialize(form)}\nstream\n`),
    content,
    encodeLatin1('\nendstream\nendobj\n'),
  ]);
  const pageAt = bytes.length + eol.length;
  const contentAt = bytes.length + pageObj.length;
  const formAt = contentAt + contentObj.length;
  const xrefStart = formAt + formObj.length;
  const root = trailerRef(newestTrailerDict(bytes), 'Root');
  if (!root) throw new Error('no /Root');
  const xref = writeXrefSection(
    'table',
    xrefStart,
    new Map<number, [number, number]>([
      [ex.page.num, [pageAt, ex.page.gen]],
      [contentNum, [contentAt, 0]],
      [formNum, [formAt, 0]],
    ]),
    size + 2,
    `/Root ${root} /Prev ${String(lastStartxref(bytes))}`,
  );
  return concatBytes([bytes, pageObj, contentObj, formObj, xref.bytes]);
}
