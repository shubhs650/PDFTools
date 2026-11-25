// Spike S34 (M14-01): what the saved pack holds, read back with the app's own
// object reader (the Work worker's PdfReader), and what Triya PDF can edit
// again when the Triya data is there, when another editor moved a markup, and
// when the data is gone. Also: does the data survive a later Ctrl+S, and what
// does a viewer that redraws a markup from its dictionary show?
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style -- test pages known to exist (spike code) */
import { PdfAnnotationSubtype } from '@embedpdf/models';
import {
  isDict,
  nameOf,
  PdfStream,
  PdfString,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import { inflateStream, PdfReader } from '../../src/model/pdf/reader.ts';
import { rawCall } from '../../src/workers/render/pdfium.ts';
import { open, renderPage, save, withAnnot, type Engine } from './engine.ts';
import type { PackItem, PackResult } from './pack.ts';
import {
  readBack,
  readPageEntries,
  type MarkupFacts,
  type ReadBack,
  type TriyaEntry,
} from './triyaData.ts';

export interface SavedMarkup extends MarkupFacts {
  page: number;
  /** Fonts in its appearance: embedded (FontFile2/3, FontFile) or not. */
  fonts: { embedded: number; standard: number };
  /** Form XObjects nested in its normal appearance (our wrapper depth). */
  depth: number;
}

export type RenderedPage = ReturnType<typeof renderPage>;

const nums = (v: PdfValue | undefined): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];

async function apFacts(r: PdfReader, ap: PdfValue | undefined) {
  const fonts = { embedded: 0, standard: 0 };
  let depth = 0;
  const seen = new Set<PdfValue>();
  const walk = async (v: PdfValue | undefined, d: number): Promise<void> => {
    const s = await r.resolve(v);
    if (!(s instanceof PdfStream) || seen.has(s)) return;
    seen.add(s);
    depth = Math.max(depth, d);
    const res = await r.resolve(s.dict.get('Resources'));
    if (!isDict(res)) return;
    const fontDict = await r.resolve(res.get('Font'));
    if (isDict(fontDict))
      for (const [, f] of fontDict) {
        const fd = await r.resolve(f);
        if (!isDict(fd)) continue;
        let desc = await r.resolve(fd.get('FontDescriptor'));
        const kids = await r.resolve(fd.get('DescendantFonts'));
        if (Array.isArray(kids)) {
          const k0 = await r.resolve(kids[0]);
          if (isDict(k0)) desc = await r.resolve(k0.get('FontDescriptor'));
        }
        if (
          isDict(desc) &&
          (desc.has('FontFile2') || desc.has('FontFile') || desc.has('FontFile3'))
        )
          fonts.embedded++;
        else fonts.standard++;
      }
    const xo = await r.resolve(res.get('XObject'));
    if (isDict(xo)) for (const [, x] of xo) await walk(x, d + 1);
  };
  const apd = await r.resolve(ap);
  if (isDict(apd)) await walk(apd.get('N'), 0);
  return { fonts, depth };
}

/** Every annotation of the saved file, and each page's Triya entries. */
export async function readSaved(bytes: Uint8Array): Promise<{
  markups: SavedMarkup[];
  entries: Map<number, Map<string, TriyaEntry>>;
  pageKeys: string[][];
}> {
  const r = await PdfReader.open(bytes, inflateStream);
  const pages = await r.pages();
  const markups: SavedMarkup[] = [];
  const entries = new Map<number, Map<string, TriyaEntry>>();
  const pageKeys: string[][] = [];
  for (const [pi, p] of pages.entries()) {
    pageKeys.push([...p.dict.keys()]);
    // Resolve the whole /PieceInfo tree (it is small) so the pure reader needs no I/O.
    const deep = async (v: PdfValue | undefined, d = 0): Promise<PdfValue | undefined> => {
      const x = await r.resolve(v);
      if (d > 10) return x;
      if (Array.isArray(x)) return Promise.all(x.map((e) => deep(e, d + 1))) as Promise<PdfValue>;
      if (isDict(x)) {
        const m: PdfDict = new Map();
        for (const [k, e] of x) m.set(k, (await deep(e, d + 1)) ?? null);
        return m;
      }
      return x;
    };
    const pageDict: PdfDict = new Map(p.dict);
    pageDict.set('PieceInfo', (await deep(p.dict.get('PieceInfo'))) ?? null);
    entries.set(pi, readPageEntries(pageDict));
    const annots = await r.resolve(p.dict.get('Annots'));
    if (!Array.isArray(annots)) continue;
    for (const a of annots) {
      const d = await r.resolve(a);
      if (!isDict(d)) continue;
      const subtype = nameOf(d.get('Subtype')) ?? '';
      if (subtype === 'Popup') continue;
      const nm = await r.resolve(d.get('NM'));
      const text = async (k: string) => {
        const v = await r.resolve(d.get(k));
        return v instanceof PdfString ? v.text() : undefined;
      };
      const rect = nums(await r.resolve(d.get('Rect'))) as [number, number, number, number];
      const L = nums(await r.resolve(d.get('L')));
      const V = nums(await r.resolve(d.get('Vertices')));
      const flat = subtype === 'Line' ? L : V;
      const points = [];
      for (let i = 0; i + 1 < flat.length; i += 2)
        points.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 });
      const ap = await apFacts(r, d.get('AP'));
      markups.push({
        page: pi,
        nm: nm instanceof PdfString ? nm.text() : '',
        subtype,
        intent: nameOf(await r.resolve(d.get('IT'))),
        contents: await text('Contents'),
        subject: await text('Subj'),
        points,
        rect,
        hasMeasure: d.has('Measure'),
        hasAppearance: d.has('AP'),
        irt: d.has('IRT'),
        group: nameOf(await r.resolve(d.get('RT'))) === 'Group',
        fonts: ap.fonts,
        depth: ap.depth,
      });
    }
  }
  return { markups, entries, pageKeys };
}

export interface CheckReport {
  /** Every pack item is exactly one annotation (the 1.1.0 pair: two, grouped). */
  oneEach: { item: string; tool: string; found: number }[];
  markups: SavedMarkup[];
  readFull: ReadBack[];
  readMoved: ReadBack[];
  readNoData: ReadBack[];
  pieceInfoPages: number[];
  lastModifiedPages: number[];
  /** After reopening and adding one more comment, a second Ctrl+S keeps the data. */
  secondSave: { tail: number; entriesAfter: number; entriesBefore: number };
  /** Per markup: ink left after PDFium redraws it from its dictionary alone. */
  redraw: { id: string; tool: string; inkBefore: number; inkAfter: number }[];
  /** Whole pages before and after the redraw (PDFium, 2 px per point). */
  redrawPictures: { page: number; before: RenderedPage; after: RenderedPage }[];
}

const ink = (img: { width: number; rgba: Uint8Array }, box: number[], scale: number, h: number) => {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box;
  let n = 0;
  for (let y = Math.floor((h - y1) * scale); y < Math.ceil((h - y0) * scale); y++)
    for (let x = Math.floor(x0 * scale); x < Math.ceil(x1 * scale); x++) {
      const o = (y * img.width + x) * 4;
      const r = img.rgba[o] ?? 255;
      const g = img.rgba[o + 1] ?? 255;
      const b = img.rgba[o + 2] ?? 255;
      // Our reds and blues only (the drawing is grey and black).
      if ((r > 150 && g < 140 && b < 140) || (b > 140 && r < 120)) n++;
    }
  return n;
};

export async function check(e: Engine, pack: PackResult): Promise<CheckReport> {
  const saved = await readSaved(pack.bytes);
  const byNm = new Map(saved.markups.map((m) => [m.nm, m]));
  const oneEach = pack.items.map((i: PackItem) => ({
    item: i.id,
    tool: i.tool,
    found: saved.markups.filter((m) => m.nm === i.id).length,
  }));
  const measured = pack.items.filter((i) => i.variant !== 'v1.1.0');
  const facts = measured.map((i) => byNm.get(i.id)).filter((m): m is SavedMarkup => !!m);
  const entryOf = (m: SavedMarkup) => saved.entries.get(m.page)?.get(m.nm);
  const readFull = facts.map((m) => readBack(m, entryOf(m)));
  // Another editor moved each markup 10 pt to the right (its geometry and /Rect change).
  const readMoved = facts.map((m) =>
    readBack(
      {
        ...m,
        points: m.points.map((p) => ({ x: p.x + 10, y: p.y })),
        rect: [m.rect[0] + 10, m.rect[1], m.rect[2] + 10, m.rect[3]],
      },
      entryOf(m),
    ),
  );
  const readNoData = facts.map((m) => readBack(m, undefined));

  // A second session: reopen, add a comment on every page, Ctrl+S. Is /PieceInfo still there?
  const doc = await open(e, pack.bytes);
  for (const pg of doc.pages) {
    const args: unknown[] = [
      doc,
      pg,
      {
        type: PdfAnnotationSubtype.SQUARE,
        id: `s34-later-${String(pg.index)}`,
        pageIndex: pg.index,
        rect: { origin: { x: 40, y: 40 }, size: { width: 20, height: 20 } },
        strokeColor: '#000000',
        strokeWidth: 1,
        color: 'transparent',
        opacity: 1,
        flags: ['print'],
      },
    ];
    await e.native.createPageAnnotation(doc, pg, args[2] as never).toPromise();
    e.tracker.recordMutation('createPageAnnotation', args);
  }
  const second = await save(e, doc, pack.bytes);
  const after = await readSaved(second.bytes);
  const count = (m: Map<number, Map<string, TriyaEntry>>) =>
    [...m.values()].reduce((s, x) => s + x.size, 0);

  // A viewer that ignores our appearance and redraws from the dictionary (PDFium as the proxy).
  const H = doc.pages.map((p) => p.size.height);
  const scale = 2;
  const before = doc.pages.map((p) => renderPage(e, doc.id, p.index, scale));
  const redraw: CheckReport['redraw'] = [];
  for (const i of measured) {
    withAnnot(e, doc.id, i.page, i.id, (a) => rawCall(e.mod, 'EPDFAnnot_GenerateAppearance', a));
  }
  const afterImgs = doc.pages.map((p) => renderPage(e, doc.id, p.index, scale));
  for (const i of measured) {
    const b = before[i.page];
    const a = afterImgs[i.page];
    const h = H[i.page] ?? 0;
    if (!b || !a) continue;
    const inkBefore = ink(b, i.rect, scale, h);
    const inkAfter = ink(a, i.rect, scale, h);
    redraw.push({ id: i.id, tool: i.tool, inkBefore, inkAfter });
  }
  await e.native.closeDocument(doc).toPromise();
  e.tracker.closed(doc.id);
  return {
    oneEach,
    markups: saved.markups,
    readFull,
    readMoved,
    readNoData,
    pieceInfoPages: saved.pageKeys.flatMap((k, i) => (k.includes('PieceInfo') ? [i] : [])),
    lastModifiedPages: saved.pageKeys.flatMap((k, i) => (k.includes('LastModified') ? [i] : [])),
    secondSave: {
      tail: second.tail,
      entriesBefore: count(saved.entries),
      entriesAfter: count(after.entries),
    },
    redraw,
    redrawPictures: doc.pages.map((p) => ({
      page: p.index,
      before: before[p.index] as RenderedPage,
      after: afterImgs[p.index] as RenderedPage,
    })),
  };
}
