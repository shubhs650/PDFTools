// Ported from spikes/s1-save/save-core.test.ts (ADR-005) to the save-base API,
// plus the second-save cases the base makes possible.
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../e2e/fixtures/generate';
import {
  concatBytes,
  isPrefix,
  latin1,
  objectNumbers,
  signatureParts,
} from '../../src/workers/render/save/bytes';
import { narrowTail, parseTailObjects } from '../../src/workers/render/save/narrowTail';
import {
  lastStartxref,
  newestTrailerDict,
  saveBaseOf,
  trailerSize,
  xrefKind,
} from '../../src/workers/render/save/xref';

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const dec = (b: Uint8Array): string => latin1(b);

const BASE: Parameters<typeof buildPdf>[0] = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Annots 5 0 R >>',
  { dict: '<< >>', stream: '0 0 m 10 10 l S' },
  '[ ]',
];

/** 1 catalog, 2 pages, 3 page, 4 content, 5 empty /Annots array. /Size 6. */
const original = (): Uint8Array => buildPdf(BASE);

/**
 * PDFium-style incremental output appended after `opened`: re-serializes 1
 * (now referencing new N), 3 (unchanged), 4 (unchanged stream whose data
 * contains "endobj" and "9 0 obj"), 5 (/Annots, now [N 0 R]) and new N.
 */
function pdfiumLikeTail(
  opened: Uint8Array,
  xref: 'table' | 'stream',
  n = 6,
  more: [number, string][] = [],
): Uint8Array {
  const objs: [number, string][] = [
    [1, `<</Type/Catalog/Pages 2 0 R/AcroForm ${String(n)} 0 R>>`],
    [3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Contents 4 0 R/Annots 5 0 R>>'],
    [4, '<</Length 26>>stream\r\nendobj 9 0 obj junk data!\r\nendstream'],
    [5, `[${String(n)} 0 R]`],
    [n, '<</Fields[]>>'],
    ...more,
  ];
  let pos = opened.length;
  const offsets = new Map<number, number>();
  let body = '';
  for (const [k, b] of objs) {
    offsets.set(k, pos + body.length);
    body += `${String(k)} 0 obj\r\n${b}\r\nendobj\r\n`;
  }
  pos += body.length;
  const prev = lastStartxref(opened);
  let tail: string;
  if (xref === 'table') {
    tail = `xref\r\n1 1\r\n${String(offsets.get(1)).padStart(10, '0')} 00000 n\r\n3 4\r\n`;
    for (const k of [3, 4, 5, n]) tail += `${String(offsets.get(k)).padStart(10, '0')} 00000 n\r\n`;
    for (const [k] of more) {
      tail += `${String(k)} 1\r\n${String(offsets.get(k)).padStart(10, '0')} 00000 n\r\n`;
    }
    tail += `trailer\r\n<</Root 1 0 R/Size ${String(n + 1)}/Prev ${String(prev)}/ID[<AA><BB>]>>\r\nstartxref\r\n${String(pos)}\r\n%%EOF\r\n`;
  } else {
    // PDFium's malformed tail xref stream: no /Type, no endobj, wrong startxref.
    tail = `${String(n + 1)} 0 obj <</Root 1 0 R /Size ${String(n + 2)}/Prev ${String(prev)}/W[0 4 1]/Index[1 1 3 4 ]/Length 3>>stream\r\nxyz\r\nendstream\r\nstartxref\r\n${String(pos - 5)}\r\n%%EOF\r\n`;
  }
  return concatBytes([opened, enc(body), enc(tail)]);
}

/** Narrow against the file PDFium opened (a first save). */
function narrowFile(orig: Uint8Array, full: Uint8Array, dirty: number[] = [], keepAll = false) {
  const r = narrowTail(saveBaseOf(orig), full, orig.length, dirty, { keepAll });
  return { ...r, bytes: concatBytes([orig, r.tail]) };
}

describe('byte and trailer helpers', () => {
  it('isPrefix / objectNumbers / trailer lookups', () => {
    const o = original();
    expect(isPrefix(o, concatBytes([o, enc('x')]))).toBe(true);
    expect(isPrefix(concatBytes([o, enc('x')]), o)).toBe(false);
    expect(objectNumbers(o)).toEqual([1, 2, 3, 4, 5]);
    expect(trailerSize(o)).toBe(6);
    expect(xrefKind(o)).toBe('table');
    expect(newestTrailerDict(o)).toContain('/Root 1 0 R');
  });

  it('finds the trailer after a classic xref table larger than 64 KB', () => {
    const big = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      ...Array.from({ length: 5000 }, () => '<< >>'),
    ]);
    expect(newestTrailerDict(big)).toMatch(/\/Size 5002/);
  });
});

describe('parseTailObjects', () => {
  it('skips stream data by /Length so embedded "endobj" / "N 0 obj" do not split objects', () => {
    const o = original();
    const objs = parseTailObjects(pdfiumLikeTail(o, 'table'), o.length);
    expect(objs.map((x) => x.num)).toEqual([1, 3, 4, 5, 6]);
    expect(objs[3]?.dict).toContain('[6 0 R]');
    expect(objs[2]?.dict).toContain('/Length 26');
  });
});

describe('narrowTail (first save)', () => {
  it('keeps new objects and existing objects that reference them; drops unchanged ones', () => {
    const o = original();
    const r = narrowFile(o, pdfiumLikeTail(o, 'table'));
    expect(r.kept).toEqual([1, 5, 6]);
    expect(r.droppedNums).toEqual([3, 4]);
    expect(isPrefix(o, r.bytes)).toBe(true);
  });

  it('keeps edit-layer dirty objects and indirect arrays they reference', () => {
    const o = original();
    expect(narrowFile(o, pdfiumLikeTail(o, 'table'), [3]).kept).toEqual([1, 3, 5, 6]);
  });

  it('appends nothing when nothing changed', () => {
    const o = original();
    const full = concatBytes([
      o,
      enc(
        '3 0 obj\r\n<</Type/Page>>\r\nendobj\r\nxref\r\n3 1\r\n0000000000 00000 n\r\ntrailer\r\n<</Root 1 0 R/Size 6>>\r\nstartxref\r\n0\r\n%%EOF\r\n',
      ),
    ]);
    const r = narrowFile(o, full);
    expect(r.kept).toEqual([]);
    expect(r.tail.length).toBe(0);
    expect(r.next).toEqual(saveBaseOf(o));
  });

  it('keepAll keeps every appended object (verification fallback)', () => {
    const o = original();
    const r = narrowFile(o, pdfiumLikeTail(o, 'table'), [], true);
    expect(r.kept).toEqual([1, 3, 4, 5, 6]);
    expect(r.droppedNums).toEqual([]);
  });

  it('writes a correct classic xref for a table original', () => {
    const o = original();
    const r = narrowFile(o, pdfiumLikeTail(o, 'table'), [3]);
    const text = dec(r.bytes);
    const xrefAt = lastStartxref(r.bytes);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    for (const m of text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)) {
      expect(/^\d+ 0 obj/.exec(text.slice(Number(m[1])))).not.toBeNull();
    }
    expect(text).toContain(`/Prev ${String(lastStartxref(o))}`);
    // The next base describes the saved file exactly.
    expect(r.next).toMatchObject({ length: r.bytes.length, startxref: xrefAt, kind: 'table' });
    expect(r.next.size).toBe(trailerSize(r.bytes));
  });

  it('writes a well-formed xref stream for an xref-stream original and fixes startxref', () => {
    const base = buildPdf(BASE);
    const prevXref = lastStartxref(base);
    const xs = `6 0 obj\n<< /Type /XRef /Size 7 /Root 1 0 R /Prev ${String(prevXref)} /ID [<AA><AA>] /W [1 4 2] /Index [6 1] /Length 7 >>\nstream\n`;
    const xsAt = base.length;
    const entry = Uint8Array.from([
      1,
      (xsAt >>> 24) & 255,
      (xsAt >>> 16) & 255,
      (xsAt >>> 8) & 255,
      xsAt & 255,
      0,
      0,
    ]);
    const o = concatBytes([
      base,
      enc(xs),
      entry,
      enc(`\nendstream\nendobj\nstartxref\n${String(xsAt)}\n%%EOF\n`),
    ]);
    expect(xrefKind(o)).toBe('stream');

    const r = narrowFile(o, pdfiumLikeTail(o, 'stream', 7));
    expect(r.xrefKind).toBe('stream');
    expect(r.kept).toEqual([1, 5, 7]);
    const text = dec(r.bytes);
    const at = lastStartxref(r.bytes);
    const head = text.slice(at, at + 200);
    expect(head).toMatch(/^\d+ 0 obj\r\n<< \/Type \/XRef /);
    expect(head).toContain('/W [1 4 2]');
    expect(head).toContain(`/Prev ${String(xsAt)}`);
    expect(head).toContain('/ID [<AA>'); // the permanent first /ID element
    expect(text.slice(at)).toContain('endobj');
    const idx = /\/Index \[([\d ]+)\]/.exec(head)?.[1]?.split(' ').map(Number) ?? [];
    const dataAt = at + text.slice(at).indexOf('stream\r\n') + 8;
    let k = 0;
    for (let i = 0; i < idx.length; i += 2) {
      for (let n = idx[i] ?? 0; n < (idx[i] ?? 0) + (idx[i + 1] ?? 0); n++) {
        const b = r.bytes.subarray(dataAt + k * 7, dataAt + k * 7 + 7);
        const off = ((b[1] ?? 0) << 24) | ((b[2] ?? 0) << 16) | ((b[3] ?? 0) << 8) | (b[4] ?? 0);
        expect(b[0]).toBe(1);
        expect(text.slice(off).startsWith(`${String(n)} 0 obj`)).toBe(true);
        k++;
      }
    }
    expect(r.next.size).toBe(trailerSize(r.bytes));
  });
});

describe('narrowTail (second save against the committed base)', () => {
  it('a second save with no further edits appends nothing', () => {
    const o = original();
    const full = pdfiumLikeTail(o, 'table');
    const first = narrowTail(saveBaseOf(o), full, o.length);
    // PDFium still appends the same objects after the opened bytes.
    const second = narrowTail(first.next, full, o.length);
    expect(second.kept).toEqual([]);
    expect(second.tail.length).toBe(0);
  });

  it('keeps objects dirtied after the first save and links /Prev to our first tail', () => {
    const o = original();
    const full = pdfiumLikeTail(o, 'table');
    const first = narrowTail(saveBaseOf(o), full, o.length);
    const second = narrowTail(first.next, full, o.length, [3]);
    // 5 is the indirect /Annots array 3 references: kept by the array rule.
    expect(second.kept).toEqual([3, 5]);
    const saved = concatBytes([o, first.tail, second.tail]);
    expect(dec(second.tail)).toContain(`/Prev ${String(first.next.startxref)}`);
    const at = lastStartxref(saved);
    const off = Number(/(\d{10}) 00000 n/.exec(dec(saved).slice(at))?.[1]);
    expect(dec(saved).slice(off).startsWith('3 0 obj')).toBe(true);
  });

  it('an object PDFium numbers like our old xref-stream object still counts as new', () => {
    const o = original();
    const full = pdfiumLikeTail(o, 'table');
    const first = narrowTail(saveBaseOf(o), full, o.length);
    // PDFium's allocator was at /Size 7 at the first save; object 7 created later is new.
    expect(first.next.newFrom).toBe(7);
    const later = pdfiumLikeTail(o, 'table', 6, [[7, '<</New true>>']]);
    expect(parseTailObjects(later, o.length).map((x) => x.num)).toContain(7);
    expect(narrowTail(first.next, later, o.length).kept).toEqual([7]);
  });
});

describe('extra objects (ADR-007 decision 5)', () => {
  it("replace PDFium's version of the same object and join the single revision", () => {
    const o = original();
    const patched = enc('3 0 obj\r\n<</Type/Page/Parent 2 0 R/VP[<</Measure 9 0 R>>]>>\r\nendobj');
    const r = narrowTail(saveBaseOf(o), pdfiumLikeTail(o, 'table'), o.length, [], {
      extra: [{ num: 3, gen: 0, bytes: patched }],
    });
    expect(r.kept).toEqual([1, 3, 5, 6]);
    const text = dec(r.tail);
    expect(text).toContain('/VP[');
    expect(text.match(/\b3 0 obj/g)).toHaveLength(1);
  });
});

describe('signatureParts', () => {
  it('extracts the exact DER from zero-padded /Contents, even when DER ends in 0x00', () => {
    const der = [0x30, 0x03, 0x02, 0x01, 0x00];
    const hex = der
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .padEnd(40, '0');
    const pre = '%PDF-1.7\n1 0 obj << /ByteRange [0 AAAAAAAAAA BBBBBBBBBB CCCCCCCCCC] /Contents <';
    const post = '> >> endobj\n%%EOF\n';
    const a = pre.length - 1;
    const b = a + 1 + hex.length + 1;
    const total = pre.length + hex.length + post.length;
    const fill = (s: string, n: number): string =>
      s.replace(/[A-C]{10}/, String(n).padStart(10, '0'));
    const text = fill(fill(fill(pre, a), b), total - b) + hex + post;
    const parts = signatureParts(enc(text));
    expect([...(parts?.cms ?? [])]).toEqual(der);
    expect(parts?.signed.length).toBe(a + (total - b));
  });
});
