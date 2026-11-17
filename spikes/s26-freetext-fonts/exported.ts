// Spike S26: reads PDFium's one-page export of an annotation appearance
// (EPDFAnnot_ExportAppearanceAsDocument). A copy of freeTextColors.ts's
// private reader (ADR-024), returning the page and the form's box and matrix.
import { unzlibSync } from 'fflate';
import {
  isDict,
  nameOf,
  numOf,
  Parser,
  PdfRef,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { latin1 } from '../../src/workers/render/save/bytes';
import { lastStartxref, newestTrailerDict, trailerRef } from '../../src/workers/render/save/xref';

export interface Exported {
  page: { num: number; gen: number; dict: PdfDict };
  resources: PdfValue;
  bbox: [number, number, number, number];
  matrix: number[];
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
export function readExport(bytes: Uint8Array): Exported | null {
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
