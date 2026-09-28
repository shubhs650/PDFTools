// Page scales (M3-15, ADR-007): each page's /VP viewports and MediaBox, read
// with our own object reader (PDFium can't read nested dictionaries) from the
// file as saved so far. Viewer-made /VP (Acrobat, PDF-XChange) read the same way.
import { isDict, PdfStream, type PdfValue } from '../../model/pdf/objects';
import { PdfReader, type Inflate } from '../../model/pdf/reader';
import { toJson, type PdfJson } from '../../model/pdf/wire';

export interface PageVp {
  page: number;
  mediaBox: [number, number, number, number];
  /** The page's /VP as plain data (null when it has none). */
  vp: PdfJson;
}

/** Refs resolved all the way down (depth-limited), streams dropped. */
async function deep(r: PdfReader, v: PdfValue | undefined, depth = 0): Promise<PdfValue> {
  if (depth > 12) return null;
  const x = (await r.resolve(v)) ?? null;
  if (x instanceof PdfStream) return null;
  if (Array.isArray(x)) return Promise.all(x.map((e) => deep(r, e, depth + 1)));
  if (isDict(x)) {
    const out = new Map<string, PdfValue>();
    for (const [k, e] of x) out.set(k, await deep(r, e, depth + 1));
    return out;
  }
  return x;
}

export async function readViewports(
  bytes: Uint8Array,
  inflate: Inflate,
  password?: string,
): Promise<PageVp[]> {
  const r = await PdfReader.open(bytes, inflate, password === undefined ? {} : { password });
  const pages = await r.pages();
  const out: PageVp[] = [];
  for (const [i, p] of pages.entries()) {
    const box = await deep(r, p.dict.get('MediaBox'));
    const mediaBox: [number, number, number, number] =
      Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number')
        ? (box as [number, number, number, number])
        : [0, 0, 612, 792];
    const vp = p.dict.get('VP');
    out.push({ page: i, mediaBox, vp: vp === undefined ? null : toJson(await deep(r, vp)) });
  }
  return out;
}
