// M3-03: the shared PDF reader (ported from the M0-S2 spike) — classic xref,
// xref streams with PNG predictors, object streams, /Prev chains, hybrid
// /XRefStm — and a cross-check against qpdf on the committed fixtures.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../e2e/fixtures/generate';
import { PdfString, isDict, nameOf } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** A small file: catalog, pages, one page, one annotation (obj 4). */
function base(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>',
    '<< /Type /Annot /Subtype /Line /L [10 10 100 10] /Rect [0 0 110 20] /Contents (v1) >>',
  ]);
}

/** Appends a classic incremental section replacing object 4. */
function update(bytes: Uint8Array, contents: string): Uint8Array {
  const text = String.fromCharCode(...bytes);
  const prev = Number([...text.matchAll(/startxref\s+(\d+)/g)].pop()?.[1]);
  const at = bytes.length;
  const obj = `4 0 obj\n<< /Type /Annot /Subtype /Line /Contents (${contents}) >>\nendobj\n`;
  const xref = at + obj.length;
  const tail = `${obj}xref\n4 1\n${String(at).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R /Prev ${String(prev)} >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  const out = new Uint8Array(bytes.length + tail.length);
  out.set(bytes);
  out.set(latin1(tail), bytes.length);
  return out;
}

/** Objects 1–3 in object stream 4, xref stream 5 with /Predictor 12 (PNG Up). */
function objStmFile(): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 50] /Title (packed) >>',
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
  return new Uint8Array(
    Buffer.concat([
      pre,
      Buffer.from(xdict, 'latin1'),
      xs,
      Buffer.from(`\nendstream\nendobj\nstartxref\n${String(xrefAt)}\n%%EOF\n`, 'latin1'),
    ]),
  );
}

describe('PdfReader', () => {
  it('reads a classic xref file and walks pages', async () => {
    const doc = await PdfReader.open(base());
    expect(doc.encrypted).toBe(false);
    expect((await doc.pages()).map((p) => p.num)).toEqual([3]);
    const annot = await doc.get(4);
    expect(isDict(annot) && nameOf(annot.get('Subtype'))).toBe('Line');
    expect(await doc.get(99)).toBeNull();
  });

  it('follows /Prev: the newest revision of an object wins', async () => {
    const doc = await PdfReader.open(update(update(base(), 'v2'), 'v3'));
    const annot = await doc.get(4);
    expect(isDict(annot) && (annot.get('Contents') as PdfString).text()).toBe('v3');
    expect((await doc.pages()).length).toBe(1);
  });

  it('reads object streams through a PNG-predicted xref stream', async () => {
    const doc = await PdfReader.open(objStmFile());
    expect((await doc.pages()).map((p) => p.num)).toEqual([3]);
    const page = await doc.get(3);
    expect(isDict(page) && (page.get('Title') as PdfString).text()).toBe('packed');
  });

  it('fails loudly on a file without a cross-reference', async () => {
    await expect(PdfReader.open(latin1('%PDF-1.7\n1 0 obj << >> endobj\n'))).rejects.toThrow(
      /startxref/,
    );
    await expect(PdfReader.open(latin1('%PDF-1.7\nstartxref\n999999\n%%EOF'))).rejects.toThrow(
      /outside/,
    );
  });

  it('refuses a page-tree cycle', async () => {
    const bytes = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [2 0 R] /Count 1 >>',
    ]);
    await expect((await PdfReader.open(bytes)).pages()).rejects.toThrow(/cycle/);
  });
});

// Every PDF committed as a fixture: our page count and every in-use object
// must agree with qpdf (ADR-007 finding 6), encrypted files included for the
// xref and page tree (their streams are refused until M3-04).
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const FIXTURE_DIRS = [
  'e2e/fixtures/self-made/s1-interop',
  'e2e/fixtures/self-made/s2-interop',
  // Public PDFs in corpus/ (whether they stay in git is an open owner decision).
  'corpus',
].filter((d) => existsSync(d));
const fixtures = FIXTURE_DIRS.flatMap((d) =>
  readdirSync(d)
    // PDFium's raw incremental save of an xref-stream file is damaged by design
    // (ADR-005 finding 5): qpdf reconstructs it, we don't.
    .filter((f) => f.endsWith('.pdf') && f !== 'objstm__incremental.pdf')
    .map((f) => join(d, f)),
);

describe.skipIf(!hasQpdf)('reader vs qpdf on the committed fixtures', () => {
  it.each(fixtures)('%s', async (file) => {
    const bytes = new Uint8Array(readFileSync(file));
    const doc = await PdfReader.open(bytes);
    const q = spawnSync('qpdf', ['--show-npages', file]).stdout.toString().trim();
    const inUse = spawnSync('qpdf', ['--show-xref', file], { maxBuffer: 256 * 1024 * 1024 })
      .stdout.toString()
      .split('\n')
      .filter((l) => /uncompressed|compressed/.test(l)).length;
    if (!doc.encrypted) {
      expect((await doc.pages()).length).toBe(Number(q));
      // Every live object parses.
      for (const [num, e] of doc.xref) if (e.type !== 0) await doc.get(num);
    } else {
      // Encrypted: the xref reads fully; object streams wait for M3-04.
      expect(doc.xref.size).toBeGreaterThan(0);
    }
    expect([...doc.xref.values()].filter((e) => e.type !== 0).length).toBe(inUse);
  });
});
