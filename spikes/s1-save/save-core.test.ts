import { describe, expect, it } from 'vitest';
import { buildPdf } from '../shared/mini-pdf.ts';
import {
  isPrefix,
  lastStartxref,
  narrowTail,
  newestTrailerDict,
  objectNumbers,
  parseTailObjects,
  signatureParts,
  trailerSize,
  xrefKind,
} from './save-core.ts';

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const dec = (b: Uint8Array): string => String.fromCharCode(...b);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const BASE: Parameters<typeof buildPdf>[0] = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Annots 5 0 R >>',
  { dict: '<< >>', stream: '0 0 m 10 10 l S' },
  '[ ]',
];

/** A 1-page original: 1 catalog, 2 pages, 3 page, 4 content, 5 empty /Annots array. /Size 6. */
function original(): Uint8Array {
  return buildPdf(BASE);
}

/**
 * A PDFium-style incremental tail: re-serializes 1 (now referencing new N),
 * 3 (unchanged), 4 (unchanged stream whose data contains "endobj" and
 * "9 0 obj"), 5 (the indirect /Annots array, now [N 0 R]) and new object N.
 */
function pdfiumLikeTail(orig: Uint8Array, xref: 'table' | 'stream', n = 6): Uint8Array {
  const objs: [number, string][] = [
    [1, `<</Type/Catalog/Pages 2 0 R/AcroForm ${String(n)} 0 R>>`],
    [3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Contents 4 0 R/Annots 5 0 R>>'],
    [4, '<</Length 26>>stream\r\nendobj 9 0 obj junk data!\r\nendstream'],
    [5, `[${String(n)} 0 R]`],
    [n, '<</Fields[]>>'],
  ];
  let pos = orig.length;
  const offsets = new Map<number, number>();
  let body = '';
  for (const [n, b] of objs) {
    offsets.set(n, pos + body.length);
    body += `${String(n)} 0 obj\r\n${b}\r\nendobj\r\n`;
  }
  pos += body.length;
  let tail: string;
  const prev = lastStartxref(orig);
  if (xref === 'table') {
    tail = 'xref\r\n1 1\r\n';
    tail += `${String(offsets.get(1)).padStart(10, '0')} 00000 n\r\n3 4\r\n`;
    for (const k of [3, 4, 5, n]) tail += `${String(offsets.get(k)).padStart(10, '0')} 00000 n\r\n`;
    tail += `trailer\r\n<</Root 1 0 R/Size ${String(n + 1)}/Prev ${String(prev)}/ID[<AA><BB>]>>\r\nstartxref\r\n${String(pos)}\r\n%%EOF\r\n`;
  } else {
    // Mimic PDFium's malformed xref stream: no /Type, no endobj, wrong startxref.
    tail = `${String(n + 1)} 0 obj <</Root 1 0 R /Size ${String(n + 2)}/Prev ${String(prev)}/W[0 4 1]/Index[1 1 3 4 ]/Length 3>>stream\r\nxyz\r\nendstream\r\nstartxref\r\n${String(pos - 5)}\r\n%%EOF\r\n`;
  }
  return concat(orig, enc(body), enc(tail));
}

describe('byte helpers', () => {
  it('isPrefix / objectNumbers / trailer lookups', () => {
    const o = original();
    expect(isPrefix(o, concat(o, enc('x')))).toBe(true);
    expect(isPrefix(concat(o, enc('x')), o)).toBe(false);
    expect(objectNumbers(o)).toEqual([1, 2, 3, 4, 5]);
    expect(trailerSize(o)).toBe(6);
    expect(xrefKind(o)).toBe('table');
    expect(newestTrailerDict(o)).toContain('/Root 1 0 R');
  });

  it('finds the trailer after a classic xref table larger than 64 KB', () => {
    const many = Array.from({ length: 5000 }, () => '<< >>');
    const big = buildPdf(['<< /Type /Catalog /Pages 2 0 R >>', ...many]);
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

describe('narrowTail', () => {
  it('keeps new objects and existing objects that reference them; drops unchanged ones', () => {
    const o = original();
    const r = narrowTail(o, pdfiumLikeTail(o, 'table'));
    // 6 is new; 1 and the array 5 reference it; 3 and 4 are unchanged.
    expect(r.kept).toEqual([1, 5, 6]);
    expect(r.droppedNums).toEqual([3, 4]);
    expect(isPrefix(o, r.bytes)).toBe(true);
  });

  it('keeps edit-layer dirty objects and indirect arrays they reference', () => {
    const o = original();
    // The page itself is unchanged here, but the edit layer reports it dirty.
    const full = pdfiumLikeTail(o, 'table');
    const r = narrowTail(o, full, [3]);
    expect(r.kept).toEqual([1, 3, 5, 6]);
  });

  it('appends nothing when nothing changed', () => {
    const o = original();
    // PDFium re-serialized only the unchanged page 3: no new objects, nothing dirty.
    const r = narrowTail(
      o,
      concat(
        o,
        enc(
          '3 0 obj\r\n<</Type/Page>>\r\nendobj\r\nxref\r\n3 1\r\n0000000000 00000 n\r\ntrailer\r\n<</Root 1 0 R/Size 6>>\r\nstartxref\r\n0\r\n%%EOF\r\n',
        ),
      ),
    );
    expect(r.kept).toEqual([]);
    expect(r.bytes).toEqual(o);
  });

  it('keepAll keeps every appended object (verification fallback)', () => {
    const o = original();
    const r = narrowTail(o, pdfiumLikeTail(o, 'table'), [], { keepAll: true });
    expect(r.kept).toEqual([1, 3, 4, 5, 6]);
    expect(r.dropped).toBe(0);
  });

  it('writes a correct classic xref for a table original', () => {
    const o = original();
    const r = narrowTail(o, pdfiumLikeTail(o, 'table'), [3]);
    const text = dec(r.bytes);
    expect(r.kept).toEqual([1, 3, 5, 6]);
    const xrefAt = lastStartxref(r.bytes);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    for (const m of text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)) {
      expect(/^\d+ 0 obj/.exec(text.slice(Number(m[1])))).not.toBeNull();
    }
    expect(text).toContain(`/Prev ${String(lastStartxref(o))}`);
  });

  it('writes a well-formed xref stream for an xref-stream original and fixes startxref', () => {
    // Original whose newest section is an (uncompressed) xref stream.
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
    const o = concat(
      base,
      enc(xs),
      entry,
      enc(`\nendstream\nendobj\nstartxref\n${String(xsAt)}\n%%EOF\n`),
    );
    expect(xrefKind(o)).toBe('stream');

    const r = narrowTail(o, pdfiumLikeTail(o, 'stream', 7));
    expect(r.xrefKind).toBe('stream');
    expect(r.kept).toEqual([1, 5, 7]);
    const text = dec(r.bytes);
    const at = lastStartxref(r.bytes);
    const head = text.slice(at, at + 200);
    expect(head).toMatch(/^\d+ 0 obj\r\n<< \/Type \/XRef /);
    expect(head).toContain('/W [1 4 2]');
    expect(head).toContain(`/Prev ${String(xsAt)}`);
    // Keeps the original's permanent first /ID element.
    expect(head).toContain('/ID [<AA>');
    expect(text.slice(at)).toContain('endobj');
    // Decode our entries and check each offset lands on its object header.
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
  });
});

describe('signatureParts', () => {
  it('extracts the exact DER from zero-padded /Contents, even when DER ends in 0x00', () => {
    const der = [0x30, 0x03, 0x02, 0x01, 0x00]; // SEQUENCE { INTEGER 0 }
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
