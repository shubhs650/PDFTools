// Tesseract's "GlyphLessFont" (pdf.ttf from the Tesseract project, Apache-2.0;
// the same bytes tesseract.js-core's PDF renderer embeds): a 572-byte TrueType
// font with one empty glyph. The OCR text layer (ADR-020 decision 4, amended)
// embeds it once per document as a CIDFontType2 with Identity-H encoding —
// 2-byte codes are UTF-16 code units — and an identity ToUnicode CMap, so a
// word in any script (Devanagari, Chinese, Latin) is extracted as its Unicode
// text by every viewer while nothing is drawn (render mode 3).
const BASE64 =
  'AAEAAAAKAIAAAwAgT1MvMlbeyJQAAAEoAAAAYGNtYXAACgA0AAABkAAAAB5nbHlmFSJBJAAAAbgAAAAYaGVhZAt48WUAAACsAAAANmhoZWEMAgQCAAAA5AAAACRobXR4BAAAAAAAAYgAAAAIbG9jYQAMAAAAAAGwAAAABm1heHAABAAFAAABCAAAACBuYW1l8usW2gAAAdAAAABLcG9zdAABAAEAAAIcAAAAIAABAAAAAQAAsJRxEF8PPPUEBwgAAAAAAM+a/G4AAAAA1MOn8gAAAAAEAAgAAAAAEAACAAAAAAAAAAEAAAgA//8AAAQAAAAAAAQAAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAQAAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAwAAAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAR09PRwBAAAAAAAAB//8AAAABAAGAAAAAAAAAAAAAAAAAAAABAAAAAAAABAAAAAAAAAIAAQAAAAAAFAADAAAAAAAUAAYACgAAAAAAAAAAAAAAAAAMAAAAAQAAAAAEAAgAAAMAADEhESEEAPwACAAAAAADACoAAAADAAAABQAWAAAAAQAAAAAABQALABYAAwABBAkABQAWAAAAVgBlAHIAcwBpAG8AbgAgADEALgAwVmVyc2lvbiAxLjAAAAEAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAA=';

/** The font program's bytes. */
export function glyphlessFontBytes(): Uint8Array {
  const bin = atob(BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Font metrics the layer's geometry uses (the FontDescriptor's /Ascent and /Descent, per em). */
export const GLYPHLESS_ASCENT = 0.8;
export const GLYPHLESS_DESCENT = -0.2;
/** Every CID has this advance (/DW), per 1000 em; words are stretched to their boxes anyway. */
export const GLYPHLESS_DW = 1000;
