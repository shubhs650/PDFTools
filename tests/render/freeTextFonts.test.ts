import { describe, expect, it } from 'vitest';
import { fontFromDA, installFontReadback } from '../../src/workers/render/freeTextFonts';

describe('text box fonts read back from /DA (M6-06)', () => {
  it('knows PDFium’s FXF_ names, base font names and the short resource names', () => {
    expect(fontFromDA('1 0 0 rg /FXF_Times-BoldItalic 14 Tf')).toBe(10);
    expect(fontFromDA('/FXF_Courier 10 Tf 0 g')).toBe(0);
    expect(fontFromDA('0 0 1 rg /Helvetica-Oblique 9.5 Tf')).toBe(7);
    expect(fontFromDA('/TiBo 12 Tf 0 g')).toBe(9);
    expect(fontFromDA('/Helv 0 Tf')).toBe(4);
    expect(fontFromDA('/F1 12 Tf')).toBeNull(); // a font of the file's own: stays Unknown
    expect(fontFromDA('0 g')).toBeNull();
  });

  it('only fills in an Unknown font on the engine instance', () => {
    const da: Record<number, { fontFamily: number; fontSize: number; fontColor: string }> = {
      1: { fontFamily: -1, fontSize: 12, fontColor: '#000000' },
      2: { fontFamily: 4, fontSize: 10, fontColor: '#ff0000' },
    };
    const strings: Record<number, string> = {
      1: '/FXF_Times-Roman 12 Tf',
      2: '/FXF_Courier 10 Tf',
    };
    const native = {
      getAnnotationDefaultAppearance: (a: number) => da[a],
      getAnnotString: (a: number, key: string) => (key === 'DA' ? strings[a] : undefined),
    };
    installFontReadback(native);
    expect(native.getAnnotationDefaultAppearance(1)).toEqual({
      fontFamily: 8,
      fontSize: 12,
      fontColor: '#000000',
    });
    expect(native.getAnnotationDefaultAppearance(2)?.fontFamily).toBe(4);
    expect(native.getAnnotationDefaultAppearance(3)).toBeUndefined();
  });
});
