import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../shared/mini-pdf.ts';
import {
  D,
  N,
  Parser,
  PdfDocument,
  PdfName,
  PdfRef,
  PdfString,
  S,
  isDict,
  nameOf,
  fmtNum,
  serialize,
  type PdfDict,
} from './pdf-object.ts';
import { appendRevision } from './revision.ts';

const inflate = (b: Uint8Array): Uint8Array => new Uint8Array(inflateSync(b));
const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const parse = (s: string) => new Parser(enc(s)).parse();

describe('Parser', () => {
  it('parses nested dicts, arrays, refs, names with #xx, numbers and strings', () => {
    const v = parse(
      '<< /A [1 -2.5 .5 3 0 R] /N#20x /x /S (a\\(b\\)\\n\\101) /H <48 65 6C6> /B true /Z null >>',
    );
    expect(isDict(v)).toBe(true);
    if (!isDict(v)) return;
    const a = v.get('A') as unknown[];
    expect(a.slice(0, 3)).toEqual([1, -2.5, 0.5]);
    expect(a[3]).toEqual(new PdfRef(3, 0));
    expect(nameOf(v.get('N x'))).toBe('x');
    expect((v.get('S') as PdfString).text()).toBe('a(b)\nA');
    expect((v.get('H') as PdfString).text()).toBe('Hel`');
    expect(v.get('B')).toBe(true);
    expect(v.get('Z')).toBeNull();
  });

  it('decodes UTF-16BE text strings', () => {
    expect((parse('<FEFF00B50020006D>') as PdfString).text()).toBe('µ m');
  });
});

describe('serialize', () => {
  it('writes reals with 10 significant digits and never in exponent form', () => {
    expect(fmtNum(0.003527777777777778)).toBe('0.003527777778');
    expect(fmtNum(35.27777777777778)).toBe('35.27777778');
    expect(fmtNum(1.5e-9)).toBe('0.0000000015');
    expect(fmtNum(-0.0000000001)).toBe('-0.0000000001');
    expect(fmtNum(12345678.25)).toBe('12345678.25');
    expect(() => fmtNum(Number.NaN)).toThrow();
  });

  it('round-trips through the parser', () => {
    const d = D({
      Type: N('Measure'),
      R: S('1 mm = 100 mm'),
      X: [D({ U: S('mm'), C: 35.277778, D: 100 })],
      P: new PdfRef(12),
      Q: S('sq m²'),
      Odd: N('a b/c'),
    });
    const text = serialize(d);
    expect(text).toContain('/Odd /a#20b#2fc');
    const back = parse(text);
    expect(serialize(back)).toBe(text);
    expect(((back as Map<string, unknown>).get('Q') as PdfString).text()).toBe('sq m²');
  });
});

/** A small file: catalog, pages, one page, one annotation (obj 4). */
function base(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>',
    '<< /Type /Annot /Subtype /Line /L [10 10 100 10] /Rect [0 0 110 20] >>',
  ]);
}

describe('PdfDocument', () => {
  it('reads a classic xref file and walks pages', () => {
    const doc = new PdfDocument(base(), inflate);
    expect(doc.encrypted).toBe(false);
    const pages = doc.pages();
    expect(pages.map((p) => p.num)).toEqual([3]);
    const annot = doc.get(4);
    expect(isDict(annot) && nameOf(annot.get('Subtype'))).toBe('Line');
  });

  it('reads object streams through a PNG-predicted xref stream', () => {
    // Objects 1–3 live in object stream 4; xref stream 5 uses /Predictor 12.
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 50] >>',
    ];
    let body = '';
    const offs: number[] = [];
    for (const o of objs) {
      offs.push(body.length);
      body += `${o}\n`;
    }
    const header = objs.map((_, i) => `${String(i + 1)} ${String(offs[i])}`).join(' ') + '\n';
    const stm = deflateSync(Buffer.from(header + body, 'latin1'));
    let pdf = '%PDF-1.7\n';
    const stmAt = pdf.length;
    pdf += `4 0 obj\n<< /Type /ObjStm /N 3 /First ${String(header.length)} /Filter /FlateDecode /Length ${String(stm.length)} >>\nstream\n`;
    const pre = Buffer.concat([
      Buffer.from(pdf, 'latin1'),
      stm,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]);
    const xrefAt = pre.length;
    // Rows (W [1 2 1]) for objects 0..5, PNG "Up" filtered.
    const rows = [
      [0, 0, 0, 0],
      [2, 0, 4, 0],
      [2, 0, 4, 1],
      [2, 0, 4, 2],
      [1, (stmAt >> 8) & 255, stmAt & 255, 0],
      [1, (xrefAt >> 8) & 255, xrefAt & 255, 0],
    ];
    const raw: number[] = [];
    let prev = [0, 0, 0, 0];
    for (const r of rows) {
      raw.push(2, ...r.map((v, i) => (v - (prev[i] ?? 0)) & 255));
      prev = r;
    }
    const xs = deflateSync(Buffer.from(raw));
    const xdict = `5 0 obj\n<< /Type /XRef /Size 6 /W [1 2 1] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >> /Length ${String(xs.length)} >>\nstream\n`;
    const file = Buffer.concat([
      pre,
      Buffer.from(xdict, 'latin1'),
      xs,
      Buffer.from(`\nendstream\nendobj\nstartxref\n${String(xrefAt)}\n%%EOF\n`, 'latin1'),
    ]);
    const doc = new PdfDocument(new Uint8Array(file), inflate);
    expect(doc.pages().map((p) => p.num)).toEqual([3]);
    expect(nameOf((doc.get(2) as Map<string, unknown>).get('Type') as PdfName)).toBe('Pages');
  });
});

describe('appendRevision', () => {
  it('adds a /Measure to an annotation and /VP to a page; the reader sees the new versions', () => {
    const bytes = base();
    const doc = new PdfDocument(bytes, inflate);
    const patched = new Map(doc.get(4) as PdfDict);
    patched.set('IT', N('LineDimension'));
    patched.set('Measure', D({ Type: N('Measure'), Subtype: N('RL'), R: S('1 m = 100 m') }));
    const page = new Map(doc.get(3) as PdfDict);
    page.set('VP', [D({ Type: N('Viewport'), BBox: [0, 0, 100, 100], Name: S('Detail A') })]);
    const out = appendRevision(
      bytes,
      doc,
      new Map([
        [4, patched],
        [3, page],
      ]),
    );

    const again = new PdfDocument(out, inflate);
    const a = again.get(4) as Map<string, unknown>;
    expect(nameOf(a.get('IT') as PdfName)).toBe('LineDimension');
    const vp = (again.get(3) as Map<string, unknown>).get('VP') as Map<string, unknown>[];
    expect((vp[0]?.get('Name') as PdfString).text()).toBe('Detail A');
    // Original bytes untouched; /Prev points at the original xref.
    expect(Buffer.from(out.subarray(0, bytes.length)).equals(Buffer.from(bytes))).toBe(true);
    expect(again.trailer.get('Prev')).toBeGreaterThan(0);
  });

  it('refuses encrypted documents', () => {
    const bytes = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [] /Count 0 >>',
    ]);
    const doc = new PdfDocument(bytes, inflate);
    doc.trailer.set('Encrypt', new PdfRef(9));
    Object.defineProperty(doc, 'encrypted', { value: true });
    expect(() => appendRevision(bytes, doc, new Map([[1, null]]))).toThrow(/encrypt/);
  });
});
