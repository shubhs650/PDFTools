// A small, deterministic PDF writer for the comparison corpus (M12-01, D-66).
// Self-made: no dependency, standard 14 fonts only (not embedded), classic
// xref table. Every byte depends only on the inputs, so the generator rebuilds
// the committed files exactly (`npm run corpus`).

import { deflateSync } from 'node:zlib';

export interface StreamBody {
  dict: string;
  stream: Uint8Array | string;
  compress?: boolean;
}
export type ObjBody = string | StreamBody;

const enc = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export class PdfWriter {
  private readonly objs: (Uint8Array | null)[] = [];

  alloc(): number {
    this.objs.push(null);
    return this.objs.length;
  }

  set(num: number, body: ObjBody): void {
    let bytes: Uint8Array;
    if (typeof body === 'string') {
      bytes = enc(`${String(num)} 0 obj\n${body}\nendobj\n`);
    } else {
      const raw = typeof body.stream === 'string' ? enc(body.stream) : body.stream;
      const compress = body.compress ?? true;
      const data = compress ? new Uint8Array(deflateSync(raw, { level: 9 })) : raw;
      const dict = body.dict.replace(/>>\s*$/, '').replace(/^<<\s*/, '');
      const head = enc(
        `${String(num)} 0 obj\n<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${String(data.length)} >>\nstream\n`,
      );
      const tail = enc('\nendstream\nendobj\n');
      bytes = new Uint8Array(head.length + data.length + tail.length);
      bytes.set(head, 0);
      bytes.set(data, head.length);
      bytes.set(tail, head.length + data.length);
    }
    this.objs[num - 1] = bytes;
  }

  add(body: ObjBody): number {
    const n = this.alloc();
    this.set(n, body);
    return n;
  }

  finish(root: number, info: number, id: string): Uint8Array {
    const header = enc('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
    const chunks: Uint8Array[] = [header];
    const offsets: number[] = [];
    let length = header.length;
    this.objs.forEach((o, i) => {
      if (!o) throw new Error(`object ${String(i + 1)} was allocated but never written`);
      offsets.push(length);
      chunks.push(o);
      length += o.length;
    });
    let xref = `xref\n0 ${String(this.objs.length + 1)}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${String(this.objs.length + 1)} /Root ${String(root)} 0 R /Info ${String(info)} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${String(length)}\n%%EOF\n`;
    chunks.push(enc(xref));
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** A PDF text string: literal when ASCII, otherwise UTF-16BE hex with a BOM. */
export function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

/** A stable 32-hex-digit file identifier from a name (FNV-1a, four lanes). */
export function fileId(name: string): string {
  let out = '';
  for (let lane = 0; lane < 4; lane++) {
    let h = (0x811c9dc5 ^ lane) >>> 0;
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out.toUpperCase();
}

/** Deterministic pseudo-random numbers (LCG), so layouts never change between runs. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The fonts every corpus page can use (one shared resource dictionary). */
export const FONTS = {
  F1: 'Helvetica',
  F2: 'Helvetica-Bold',
  F3: 'Courier',
  F4: 'Helvetica-Oblique',
  /** Helvetica with the fi and fl ligature glyphs on codes 1 and 2 (no ToUnicode). */
  FL: 'Helvetica',
} as const;
export type FontKey = keyof typeof FONTS;

export interface DocInfo {
  title: string;
  author: string;
  subject: string;
  creationDate: string;
  modDate: string;
}

export interface PageSpec {
  /** Page size in points. */
  width: number;
  height: number;
  content: string;
  rotate?: number;
  /** Builds the page's annotations once its object number is known. */
  annots?: (w: PdfWriter, page: number) => number[];
}

/** One PDF document: shared fonts and graphics states, pages in order. */
export class Doc {
  readonly w = new PdfWriter();
  private readonly catalog = this.w.alloc();
  private readonly pagesRef = this.w.alloc();
  private readonly resources: number;
  private readonly pages: number[] = [];
  /** Object numbers of the shared fonts, for annotation appearance streams. */
  readonly fontRefs: Record<FontKey, number>;

  constructor() {
    const refs: Partial<Record<FontKey, number>> = {};
    const fontRefs = Object.entries(FONTS).map(([key, base]) => {
      const encoding =
        key === 'FL'
          ? '<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 /fi /fl] >>'
          : '/WinAnsiEncoding';
      const ref = this.w.add(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding ${encoding} >>`,
      );
      refs[key as FontKey] = ref;
      return `/${key} ${String(ref)} 0 R`;
    });
    this.fontRefs = refs as Record<FontKey, number>;
    this.resources = this.w.add(
      `<< /Font << ${fontRefs.join(' ')} >> /ExtGState << /GSmul << /Type /ExtGState /BM /Multiply >> >> >>`,
    );
  }

  addPage(p: PageSpec): number {
    const ref = this.w.alloc();
    const contents = this.w.add({ dict: '<< >>', stream: p.content });
    const annots = p.annots ? p.annots(this.w, ref) : [];
    this.w.set(
      ref,
      `<< /Type /Page /Parent ${String(this.pagesRef)} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}]${
        p.rotate ? ` /Rotate ${String(p.rotate)}` : ''
      } /Resources ${String(this.resources)} 0 R /Contents ${String(contents)} 0 R${
        annots.length ? ` /Annots [${annots.map((a) => `${String(a)} 0 R`).join(' ')}]` : ''
      } >>`,
    );
    this.pages.push(ref);
    return ref;
  }

  get pageRefs(): readonly number[] {
    return this.pages;
  }

  /** `catalogExtra` adds entries to the catalog, e.g. `/PageLabels << … >>`. */
  finish(info: DocInfo, idSeed: string, catalogExtra = ''): Uint8Array {
    this.w.set(
      this.catalog,
      `<< /Type /Catalog /Pages ${String(this.pagesRef)} 0 R${catalogExtra ? ` ${catalogExtra}` : ''} >>`,
    );
    this.w.set(
      this.pagesRef,
      `<< /Type /Pages /Kids [${this.pages.map((p) => `${String(p)} 0 R`).join(' ')}] /Count ${String(this.pages.length)} >>`,
    );
    const infoRef = this.w.add(
      `<< /Title ${pdfString(info.title)} /Author ${pdfString(info.author)} /Subject ${pdfString(info.subject)} /Creator (Triya PDF corpus generator) /Producer (Triya PDF corpus generator) /CreationDate (${info.creationDate}) /ModDate (${info.modDate}) >>`,
    );
    return this.w.finish(this.catalog, infoRef, fileId(idSeed));
  }
}

/** Formats a number for a content stream: at most 3 decimals, no trailing zeros. */
export function num(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  if (Object.is(r, -0) || r === 0) return '0';
  return String(r);
}

export const MM = 72 / 25.4;
