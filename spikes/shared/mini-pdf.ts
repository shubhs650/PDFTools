// Tiny PDF writer for self-made spike fixtures (CLAUDE.md rule 13).
// Objects are passed as raw PDF syntax; the writer adds the header, xref table
// and trailer. Object 1 must be the catalog.

export function buildPdf(objects: (string | { dict: string; stream: string })[]): Uint8Array {
  const parts: string[] = ['%PDF-1.7\n%âãÏÓ\n'];
  const offsets: number[] = [];
  let length = byteLen(parts[0] ?? '');
  objects.forEach((obj, i) => {
    offsets.push(length);
    const body =
      typeof obj === 'string'
        ? obj
        : `${obj.dict.replace(/>>\s*$/, '')} /Length ${String(byteLen(obj.stream))} >>\nstream\n${obj.stream}\nendstream`;
    const s = `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
    parts.push(s);
    length += byteLen(s);
  });
  const xrefStart = length;
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefStart)}\n%%EOF\n`;
  parts.push(xref);
  return latin1(parts.join(''));

  function byteLen(s: string): number {
    return latin1(s).length;
  }
  function latin1(s: string): Uint8Array {
    // All content is ASCII or Latin-1 by construction (CJK text is hex-encoded).
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
}

/** UTF-16BE hex string for use with the UniGB-UCS2-H CMap. */
export function ucs2Hex(text: string): string {
  let hex = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) throw new Error('BMP only');
    hex += cp.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

/**
 * One A4 page: a Latin line in Helvetica (standard 14, no fallback needed) and a
 * large Simplified Chinese line in a *non-embedded* CID font (Adobe-GB1). PDFium
 * has no glyphs for the latter, so it asks the system-font hook for a GB2312
 * font — exactly the path that EmbedPDF's font fallback serves.
 */
export function cjkFallbackPdf(): Uint8Array {
  const content = [
    'BT /F1 24 Tf 60 760 Td (PDFTools S8 font fallback fixture) Tj ET',
    `BT /F2 96 Tf 60 560 Td ${ucs2Hex('中文测试')} Tj ET`,
    `BT /F2 96 Tf 60 400 Td ${ucs2Hex('工程图纸')} Tj ET`,
  ].join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: content },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [7 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 8 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
  ]);
}
