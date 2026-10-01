// M4-17 (§7.9 step 3, ADR-017 decision 5): sanitize on an object-layer
// fixture — catalog data, page thumbnails, Info, fields of removed widgets,
// and bookmarks (at any level) pointing into a redacted rectangle.
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../e2e/fixtures/generate';
import { isDict, PdfRef, type PdfDict } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { sanitize } from '../../src/workers/work/redact/sanitize';

// 1 catalog, 2 pages, 3 page, 4 contents, 5 outlines, 6 A, 7 A.1 (into rect), 8 A.2, 9 B, 10 info,
// 11 xmp, 12 thumb, 13 field/widget, 14 js
function fixture(): Uint8Array {
  return buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R /Metadata 11 0 R /StructTreeRoot << >> /MarkInfo << /Marked true >> /AcroForm << /Fields [13 0 R] >> /Names << /JavaScript << /Names [(a) 14 0 R] >> /EmbeddedFiles << /Names [] >> /Dests << >> >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Thumb 12 0 R /PieceInfo << >> /Annots [13 0 R] >>',
      { dict: '<< >>', stream: '' },
      '<< /Type /Outlines /First 6 0 R /Last 9 0 R /Count 2 >>',
      '<< /Title (A) /Parent 5 0 R /Next 9 0 R /First 7 0 R /Last 8 0 R /Count 2 /Dest [3 0 R /XYZ 10 10 0] >>',
      '<< /Title (A.1) /Parent 6 0 R /Next 8 0 R /Dest [3 0 R /XYZ 150 150 0] >>',
      '<< /Title (A.2) /Parent 6 0 R /Prev 7 0 R /Dest [3 0 R /XYZ 500 700 0] >>',
      '<< /Title (B) /Parent 5 0 R /Prev 6 0 R /Dest [3 0 R /XYZ 20 20 0] >>',
      '<< /Title (secret) >>',
      { dict: '<< /Type /Metadata /Subtype /XML >>', stream: '<x/>' },
      { dict: '<< >>', stream: '' },
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (f) /Rect [120 120 180 140] /P 3 0 R >>',
      '<< /S /JavaScript /JS (app.alert(1)) >>',
    ],
    ' /Info 10 0 R',
  );
}

describe('sanitize', () => {
  it('drops document data, prunes fields and nested bookmarks, points /Info at an empty dictionary', async () => {
    const src = fixture();
    const { bytes, report } = await sanitize(
      src,
      new Map([[3, [[100, 100, 200, 200]]]]),
      new Set([13]),
    );
    const r = await PdfReader.open(bytes);
    const root = (await r.get(r.trailer.get('Root') as PdfRef)) as PdfDict;
    for (const k of ['Metadata', 'StructTreeRoot', 'MarkInfo']) expect(root.has(k)).toBe(false);
    const names = (await r.resolve(root.get('Names'))) as PdfDict;
    expect([...names.keys()]).toEqual(['Dests']);
    const acro = (await r.resolve(root.get('AcroForm'))) as PdfDict;
    expect(acro.get('Fields')).toEqual([]);
    const [page] = await r.pages();
    expect(page?.dict.has('Thumb')).toBe(false);
    expect(page?.dict.has('PieceInfo')).toBe(false);
    const info = await r.resolve(r.trailer.get('Info'));
    expect(isDict(info) && info.size).toBe(0);
    // A keeps only A.2 (A.1 pointed into the rectangle); B stays.
    const a = (await r.get(6)) as PdfDict;
    expect((a.get('First') as PdfRef).num).toBe(8);
    expect((a.get('Last') as PdfRef).num).toBe(8);
    expect(a.get('Count')).toBe(1);
    const a2 = (await r.get(8)) as PdfDict;
    expect(a2.has('Prev')).toBe(false);
    expect(report.outlineItemsRemoved).toBe(1);
    expect(report.fieldsRemoved).toBe(1);
    expect(report.removed).toEqual(
      expect.arrayContaining(['/Root/Metadata', '/Root/Names/JavaScript', '/Page/Thumb', '/Info']),
    );
    // One incremental section on top of the input (PDFium rewrites it once more in the job).
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, src.length))).toBe(
      new TextDecoder('latin1').decode(src),
    );
  });
});
