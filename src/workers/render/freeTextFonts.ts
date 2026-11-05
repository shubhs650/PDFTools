// A text box's font, read back (M6-06). EmbedPDF writes /DA with the font's
// resource name from PDFium's appearance (`/FXF_Times-Bold 10 Tf`), but its
// own reader knows only Helvetica's `/Helv`: every other standard font came
// back as Unknown, so a reopened Times or Courier text box showed Helvetica in
// the Properties pane, and the next edit rewrote it as Helvetica. Acrobat and
// PDF-XChange write their own short names (`/TiBo`, `/Cour`). Here an Unknown
// font is looked up by the name in /DA. The appearance stream is not touched.
// The text colour (ADR-024): EmbedPDF reads it from its own /TextColor, else
// from /DA, which Acrobat and PDF-XChange use for the border; their text
// colour is in /DS (`color:#0000FF`), read here when there is no /TextColor.
import { colorFromDefaultStyle } from '../../model/freeTextStyle';

/** PdfStandardFont values by base font name and by the usual /DR resource names. */
const FONTS: Readonly<Record<string, number>> = {
  Courier: 0,
  'Courier-Bold': 1,
  'Courier-BoldOblique': 2,
  'Courier-Oblique': 3,
  Helvetica: 4,
  'Helvetica-Bold': 5,
  'Helvetica-BoldOblique': 6,
  'Helvetica-Oblique': 7,
  'Times-Roman': 8,
  'Times-Bold': 9,
  'Times-BoldItalic': 10,
  'Times-Italic': 11,
  Symbol: 12,
  ZapfDingbats: 13,
  // Short resource names (Acrobat, PDF-XChange, PDFium's own /Helv).
  Cour: 0,
  CoBo: 1,
  CoBO: 2,
  CoOb: 3,
  Helv: 4,
  HeBo: 5,
  HeBO: 6,
  HeOb: 7,
  TiRo: 8,
  TiBo: 9,
  TiBI: 10,
  TiIt: 11,
  Symb: 12,
  ZaDb: 13,
};

const UNKNOWN = -1;

/** The standard font a /DA string names (`/Name size Tf`), or null. Pure. */
export function fontFromDA(da: string): number | null {
  const m = /\/([^\s/()<>[\]{}%]+)\s+[-+]?(?:\d+\.?\d*|\.\d+)\s+Tf\b/u.exec(da);
  if (!m?.[1]) return null;
  const name = m[1].replace(/^FXF_/u, '');
  return FONTS[name] ?? null;
}

interface DaReader {
  getAnnotationDefaultAppearance(
    annot: number,
  ): { fontFamily: number; fontSize: number; fontColor: string } | undefined;
  getAnnotString(annot: number, key: string): string | undefined;
  getAnnotationColor(annot: number, colorType: number): string | undefined;
  readPdfFreeTextAnno(doc: unknown, page: unknown, annot: number, index: number): unknown;
}

/** PdfAnnotationColorType.TextColor (EmbedPDF's private /TextColor). */
const TEXT_COLOR = 3;

/** Hooks the engine instance's /DA and FreeText readers (once, at init). */
export function installFontReadback(native: unknown): void {
  const n = native as DaReader;
  if (typeof n.readPdfFreeTextAnno === 'function') {
    const readFreeText = n.readPdfFreeTextAnno.bind(n);
    n.readPdfFreeTextAnno = (doc, page, annot, index) => {
      const out = readFreeText(doc, page, annot, index);
      if (typeof out !== 'object' || out === null) return out;
      if (n.getAnnotationColor(annot, TEXT_COLOR) !== undefined) return out;
      const color = colorFromDefaultStyle(n.getAnnotString(annot, 'DS'));
      return color ? { ...out, fontColor: color.toLowerCase() } : out;
    };
  }
  if (typeof n.getAnnotationDefaultAppearance !== 'function') return;
  const read = n.getAnnotationDefaultAppearance.bind(n);
  n.getAnnotationDefaultAppearance = (annot) => {
    const da = read(annot);
    if (da?.fontFamily !== UNKNOWN) return da;
    const raw = n.getAnnotString(annot, 'DA');
    const font = raw ? fontFromDA(raw) : null;
    return font === null ? da : { ...da, fontFamily: font };
  };
}
