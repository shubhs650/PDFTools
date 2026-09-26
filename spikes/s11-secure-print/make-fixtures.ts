// M2-02 spike fixtures (self-made, generated at run time, never committed —
// CLAUDE.md rule 13): a full AcroForm, XFA markers, print-flag annotations,
// and qpdf-encrypted variants (R2, R3, R4, R6) with user and owner passwords.
import { buildPdf } from '../../e2e/fixtures/generate.ts';

export { ROW_ORDER, fullFormPdf } from '../../e2e/fixtures/generate.ts';
export {
  OWNER_PW,
  USER_PW,
  encryptedVariants,
  type EncryptedVariant,
} from '../../e2e/fixtures/encrypted.ts';

/** An AcroForm that also carries an XFA packet (hybrid, "XFA foreground"). */
export function xfaHybridPdf(full = false): Uint8Array {
  return buildPdf([
    `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /XFA 5 0 R >>${full ? ' /NeedsRendering true' : ''} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    { dict: '<< >>', stream: '' },
    {
      dict: '<< >>',
      stream:
        '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"/></xdp:xdp>',
    },
  ]);
}

/**
 * Two squares with appearance streams: one with the Print flag (/F 4), one
 * without (/F 0, "screen only"). A print render must drop the second.
 */
export function printFlagPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Annots [5 0 R 6 0 R] >>',
    { dict: '<< >>', stream: '' },
    '<< /Type /Annot /Subtype /Square /Rect [50 700 150 800] /F 4 /C [1 0 0] /AP << /N 7 0 R >> >>',
    '<< /Type /Annot /Subtype /Square /Rect [400 50 500 150] /F 0 /C [0 0 1] /AP << /N 7 0 R >> >>',
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] >>',
      stream: '0 g 0 0 100 100 re f',
    },
  ]);
}
