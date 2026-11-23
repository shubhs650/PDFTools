// A self-made "stress sheet" pair (rule 13; from spike S29's make-fixtures)
// with everything the vector overlay's recolouring has to handle besides
// plain colour instructions: an RGB image, an image mask, an inline image, an
// axial shading (sh) in a clip, a shading pattern fill, a spot (Separation)
// colour, ICC and CMYK colours, a nested form, stroked text, zero-width
// hairlines, a white knock-out fill and transparency. Rev B changes a few of
// each, so the overlay shows red and green (M12-16).
import { buildPdf } from './generate.ts';

const W = 842;
const H = 595;

/** A 16 × 16 RGB image: a diagonal ramp (hex). */
function rampImage(shift: number): string {
  let hex = '';
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = ((x + y + shift) * 8) & 0xff;
      hex += [v, 255 - v, (v * 3) & 0xff].map((c) => c.toString(16).padStart(2, '0')).join('');
    }
  return `${hex}>`;
}

/** A 16 × 16 stencil (1 bit): a ring. */
function ringMask(r: number): string {
  let hex = '';
  for (let y = 0; y < 16; y++) {
    let bits = 0;
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      bits = (bits << 1) | (Math.abs(d - r) < 1.6 ? 0 : 1);
    }
    hex += bits.toString(16).padStart(4, '0');
  }
  return `${hex}>`;
}

/**
 * The stress sheet of revision `rev`. `type3`: the title is set in a Type 3
 * font whose glyph sets its own colour (d0), which the builder draws through
 * one mask for the whole page (S29 risk 1).
 */
export function stressSheet(rev: 'A' | 'B', opts: { type3?: boolean } = {}): Uint8Array {
  const b = rev === 'B';
  const content = [
    // Border and title (unchanged).
    '0 G 1.2 w 20 20 802 555 re S',
    opts.type3
      ? 'BT /F3 14 Tf 30 555 Td (aaaa) Tj ET'
      : 'BT /F1 14 Tf 30 555 Td (STRESS SHEET - ROUTE 2 CORNER CASES) Tj ET',
    `BT /F1 10 Tf 680 30 Td (REV ${rev}) Tj ET`,
    // Zero-width hairline grid (unchanged) and one hairline that moves.
    '0.4 G 0 w',
    ...Array.from(
      { length: 12 },
      (_, i) => `${String(40 + i * 20)} 60 m ${String(40 + i * 20)} 240 l S`,
    ),
    `0 0 1 RG 0 w 40 ${b ? '250' : '245'} m 260 ${b ? '250' : '245'} l S`,
    // CMYK fill and DeviceGray stroke.
    `0 0.6 1 0 k 300 60 80 ${b ? '90' : '60'} re f`,
    '0.2 G 2 w 300 60 80 90 re S',
    // ICC-based RGB colour (resource /CSicc) and a spot colour (/CSspot).
    '/CSicc cs 0.1 0.5 0.9 sc 400 60 60 60 re f',
    `/CSspot CS 1 SCN 3 w 400 140 m ${b ? '520' : '470'} 200 l S`,
    // A nested form with its own colours (moved in B).
    `q 1 0 0 1 ${b ? '520' : '500'} 60 cm /Fm1 Do Q`,
    // An RGB image (changed ramp in B) and an image mask (bigger ring in B).
    'q 100 0 0 100 40 300 cm /Im1 Do Q',
    `q 0.8 0 0.2 rg 100 0 0 100 160 300 cm /Mk1 Do Q`,
    // An inline image (unchanged).
    'q 40 0 0 40 280 300 cm BI /W 2 /H 2 /CS /G /BPC 8 ID ',
    '\u0000ÿÿ\u0000 EI Q',
    // An axial shading painted with sh inside a clip, and a pattern fill.
    `q 340 300 120 ${b ? '120' : '100'} re W n /Sh1 sh Q`,
    `/Pattern cs /P1 scn 480 300 120 100 re f`,
    // Stroked text (render mode 1), transparency, a white knock-out.
    `BT 1 Tr 0.8 w 0 0.5 0 RG /F1 36 Tf 40 450 Td (${b ? 'Rev B outline' : 'Rev A outline'}) Tj ET`,
    '/GSa gs 1 0 0 rg 640 300 120 120 re f',
    '0 G 1 w 620 440 m 800 440 l S 620 460 m 800 460 l S',
    `1 g 640 ${b ? '430' : '435'} 60 40 re f`,
  ].join('\n');
  const formContent = `0 0 1 rg 0 0 60 40 re f 1 0 0 RG 2 w 0 0 m 60 40 l S`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(W)} ${String(H)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F3 13 0 R >> /XObject << /Fm1 6 0 R /Im1 7 0 R /Mk1 8 0 R >> /ColorSpace << /CSicc [/ICCBased 9 0 R] /CSspot [/Separation /PantoneX /DeviceCMYK 10 0 R] >> /Shading << /Sh1 11 0 R >> /Pattern << /P1 12 0 R >> /ExtGState << /GSa << /ca 0.5 >> >> >> >>`,
    { dict: '<< >>', stream: content },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 60 40] >>', stream: formContent },
    {
      dict: '<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode >>',
      stream: rampImage(b ? 6 : 0),
    },
    {
      dict: '<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ImageMask true /BitsPerComponent 1 /Filter /ASCIIHexDecode >>',
      stream: ringMask(b ? 6 : 4.5),
    },
    // A 3-component ICC stand-in: the alternate is what readers use without a
    // profile parser; the profile data is a placeholder (rule 13: self-made).
    { dict: '<< /N 3 /Alternate /DeviceRGB >>', stream: '' },
    '<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0.3 1 0.1] /N 1 >>',
    '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [340 300 460 420] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 1 0] /C1 [0 0 0.6] /N 1 >> /Extend [true true] >>',
    '<< /Type /Pattern /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [480 300 600 300] /Function << /FunctionType 2 /Domain [0 1] /C0 [0.9 0.9 0.9] /C1 [0.1 0.3 0.1] /N 1 >> >> >>',
    // A Type 3 font with one glyph ("a") that paints itself orange (d0).
    '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a 14 0 R >> /Encoding << /Type /Encoding /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1000] /Resources << >> >>',
    { dict: '<< >>', stream: '1000 0 d0 1 0.5 0 rg 100 100 800 800 re f' },
  ]);
}
