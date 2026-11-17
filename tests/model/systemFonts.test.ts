// Fonts installed on this computer (M11-08·O5, D-54): what a font file
// allows (embedding bits, outlines), a face cut out of a collection, the
// standard fallback, Local Font Access's faces grouped into families, the
// runtime registry and the font list's "On this computer" section.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asCffFont, buildCollection, tablesOf, withFsType } from '../../e2e/fixtures/fonts';
import {
  libraryFamily,
  libraryFamilyByName,
  setSystemFamilies,
  systemFontId,
  updateSystemFamily,
  isSystemFontId,
  resolveFace,
} from '../../src/model/fonts/library';
import {
  bytesReader,
  embeddingOf,
  extractFace,
  hasTable,
  inspectFont,
  standardOf,
} from '../../src/model/fonts/sfnt';
import { checkFace, groupLocalFonts, weightOf } from '../../src/model/fonts/systemFamilies';
import { fontSections, SHOW_SYSTEM_ID } from '../../src/features/annotate/fonts/fontList';
import { cssFontStack, cssString } from '../../src/features/annotate/fonts/commentFonts';

const FILES = join(import.meta.dirname, '..', '..', 'vendor', 'fonts', 'files');
const font = (f: string) => new Uint8Array(readFileSync(join(FILES, f)));
const arimo = font('arimo-regular.ttf');
const cousine = font('cousine-regular.ttf');
const notoSerif = font('notoserif-regular.ttf');

afterEach(() => {
  setSystemFamilies([]);
});

describe('font files (sfnt.ts)', () => {
  it('reads the embedding bits as the OpenType spec says (least restrictive wins)', () => {
    expect(embeddingOf(0)).toBe('ok'); // installable
    expect(embeddingOf(0x0002)).toBe('restricted');
    expect(embeddingOf(0x0004)).toBe('ok'); // preview & print: embedded for viewing
    expect(embeddingOf(0x0008)).toBe('ok'); // editable
    expect(embeddingOf(0x0006)).toBe('ok'); // old fonts with several bits
    expect(embeddingOf(0x0200)).toBe('bitmap');
    expect(embeddingOf(0x0100)).toBe('noSubset');
    expect(embeddingOf(0x0102)).toBe('restricted');
  });

  it('finds the standard fallback from post, the IBM class and PANOSE', () => {
    expect(standardOf(0, true)).toBe('courier');
    expect(standardOf(0, false, [2, 11, 4, 9])).toBe('courier');
    expect(standardOf(1 << 8, false)).toBe('times');
    expect(standardOf(7 << 8, false)).toBe('times');
    expect(standardOf(8 << 8, false)).toBe('helvetica');
    expect(standardOf(0, false, [2, 2, 5, 2])).toBe('times');
    expect(standardOf(0, false, [2, 11, 6, 4])).toBe('helvetica');
    expect(standardOf(0, false)).toBe('helvetica');
  });

  it('inspects a TrueType font: usable, its name and fallback', async () => {
    const r = await inspectFont(bytesReader(arimo), 'whatever');
    expect(r).toMatchObject({ use: 'ok', collection: false, index: 0, variable: false });
    expect(r.postscriptName).toMatch(/^Arimo/u);
    expect((await inspectFont(bytesReader(cousine))).standard).toBe('courier');
    expect((await inspectFont(bytesReader(notoSerif))).standard).toBe('times');
    expect((await inspectFont(bytesReader(font('ibmplexsans-upright.ttf')))).variable).toBe(true);
  });

  it('refuses a font whose license forbids embedding, bitmap-only or no-subset fonts', async () => {
    const use = async (b: Uint8Array) => (await inspectFont(bytesReader(b))).use;
    expect(await use(withFsType(arimo, 0x0002))).toBe('restricted');
    expect(await use(withFsType(arimo, 0x0200))).toBe('bitmap');
    expect(await use(withFsType(arimo, 0x0100))).toBe('noSubset');
    expect(await use(withFsType(arimo, 0x0004))).toBe('ok');
  });

  it('lists a CFF font as not usable, and garbage as unreadable', async () => {
    expect((await inspectFont(bytesReader(asCffFont(arimo)))).use).toBe('outlines');
    expect((await inspectFont(bytesReader(new Uint8Array(40)))).use).toBe('unreadable');
    expect((await inspectFont(bytesReader(new Uint8Array(3)))).use).toBe('unreadable');
  });

  it('finds the named face of a collection and cuts it out as a font of its own', async () => {
    const restricted = withFsType(cousine, 0x0002);
    const ttc = buildCollection([arimo, restricted]);
    const first = await inspectFont(bytesReader(ttc), '');
    expect(first).toMatchObject({ collection: true, index: 0, use: 'ok' });
    const cousinePs = (await inspectFont(bytesReader(cousine))).postscriptName;
    const second = await inspectFont(bytesReader(ttc), cousinePs);
    expect(second).toMatchObject({ collection: true, index: 1, use: 'restricted' });
    expect(second.postscriptName).toBe(cousinePs);
    // Cut out: the same tables as the original face, byte for byte.
    const cut = extractFace(ttc, 0);
    const a = tablesOf(arimo).tables;
    const b = tablesOf(cut).tables;
    expect(b.map((t) => t.tag)).toEqual(a.map((t) => t.tag));
    for (const [i, t] of a.entries())
      expect(Buffer.from(b[i]?.data ?? []).equals(Buffer.from(t.data))).toBe(true);
    expect(await inspectFont(bytesReader(cut))).toMatchObject({ collection: false, use: 'ok' });
    expect(extractFace(arimo, 0)).toBe(arimo);
    expect(() => extractFace(ttc, 2)).toThrow();
  });

  it('knows whether a font has a table', () => {
    expect(hasTable(font('ibmplexsans-upright.ttf'), 'fvar')).toBe(true);
    expect(hasTable(arimo, 'fvar')).toBe(false);
    expect(hasTable(arimo, 'glyf')).toBe(true);
  });
});

describe("Local Font Access's faces as families", () => {
  const face = (family: string, style: string, postscriptName: string) => ({
    family,
    style,
    postscriptName,
  });

  it('reads the weight a style names', () => {
    expect(weightOf('Regular')).toBe(400);
    expect(weightOf('Bold Italic')).toBe(700);
    expect(weightOf('SemiBold')).toBe(600);
    expect(weightOf('Extra Light')).toBe(200);
    expect(weightOf('Black')).toBe(900);
    expect(weightOf('Condensed')).toBe(400);
  });

  it('groups faces into families with regular, bold, italic and bold italic, sorted', () => {
    const fams = groupLocalFonts([
      face('Zeta Sans', 'Regular', 'ZetaSans-Regular'),
      face('Arial', 'Bold', 'Arial-BoldMT'),
      face('Arial', 'Regular', 'ArialMT'),
      face('Arial', 'Italic', 'Arial-ItalicMT'),
      face('Arial', 'Bold Italic', 'Arial-BoldItalicMT'),
      face('Arial', 'Narrow', 'ArialNarrow'),
      face('Arial', 'Black', 'Arial-Black'),
      face('.SF NS', 'Regular', 'SFNS'),
      face('ISOCPEUR', 'Italic', 'ISOCPEUR-Italic'),
    ]);
    expect(fams.map((f) => f.name)).toEqual(['Arial', 'ISOCPEUR', 'Zeta Sans']);
    const arial = fams[0];
    expect(arial?.id).toBe('sys:Arial');
    expect(arial?.group).toBe('system');
    expect(arial?.faces).toEqual({
      regular: { file: 'sys:ArialMT', wght: 400 },
      bold: { file: 'sys:Arial-BoldMT', wght: 700 },
      italic: { file: 'sys:Arial-ItalicMT', wght: 400 },
      boldItalic: { file: 'sys:Arial-BoldItalicMT', wght: 700 },
    });
    // Only an italic face: that face draws it, the rest is synthesized.
    const iso = fams[1];
    expect(iso && checkFace(iso)?.file).toBe('sys:ISOCPEUR-Italic');
    expect(iso && resolveFace(iso, false, false)).toMatchObject({
      face: { file: 'sys:ISOCPEUR-Italic' },
      fakeItalic: false,
    });
  });

  it('registers them at runtime: ids, names read back from /DS, checks', () => {
    expect(isSystemFontId('sys:Arial')).toBe(true);
    expect(isSystemFontId('sys:')).toBe(false);
    expect(isSystemFontId('arimo')).toBe(false);
    // Not registered (not allowed yet, or not installed here): no faces, its standard fallback.
    expect(libraryFamily('sys:Arial')).toMatchObject({ name: 'Arial', group: 'system', faces: {} });
    expect(libraryFamilyByName('Arial')).toBeUndefined();
    setSystemFamilies(groupLocalFonts([face('Arial', 'Regular', 'ArialMT')]));
    expect(libraryFamily('sys:Arial')?.faces.regular?.file).toBe('sys:ArialMT');
    expect(libraryFamilyByName("'arial'")?.id).toBe('sys:Arial');
    // The library wins on a name both have.
    setSystemFamilies(groupLocalFonts([face('Inter', 'Regular', 'Inter-Regular')]));
    expect(libraryFamilyByName('Inter')?.id).toBe('inter');
    updateSystemFamily(systemFontId('Inter'), { standard: 'times', blocked: 'restricted' });
    expect(libraryFamily('sys:Inter')).toMatchObject({ standard: 'times', blocked: 'restricted' });
    updateSystemFamily('sys:Inter', { blocked: undefined });
    expect(libraryFamily('sys:Inter')?.blocked).toBeUndefined();
  });
});

describe('the font list with fonts on this computer', () => {
  it('has no such section where the browser cannot list them', () => {
    const ids = fontSections([], {
      supported: false,
      state: 'off',
      ids: [],
      checks: {},
    }).map((s) => s.id);
    expect(ids).not.toContain('system');
    expect(fontSections([]).map((s) => s.id)).not.toContain('system');
  });

  it('offers "Show fonts on this computer…" until they are listed', () => {
    for (const [state, key] of [
      ['off', 'fonts.system.show'],
      ['loading', 'fonts.system.loading'],
      ['denied', 'fonts.system.denied'],
      ['error', 'fonts.system.error'],
    ] as const) {
      const sys = fontSections([], { supported: true, state, ids: [], checks: {} }).at(-1);
      expect(sys?.id).toBe('system');
      expect(sys?.options).toEqual([{ id: SHOW_SYSTEM_ID, name: { key }, action: 'showSystem' }]);
    }
  });

  it('lists the families, the ones that cannot be used disabled with the reason', () => {
    const fams = groupLocalFonts([
      { family: 'Arial', style: 'Regular', postscriptName: 'ArialMT' },
      { family: 'Secret', style: 'Regular', postscriptName: 'Secret' },
    ]);
    setSystemFamilies(fams);
    const sys = fontSections(['sys:Arial'], {
      supported: true,
      state: 'on',
      ids: fams.map((f) => f.id),
      checks: { 'sys:Arial': 'ok', 'sys:Secret': 'restricted' },
    });
    expect(sys[0]?.id).toBe('recent');
    expect(sys[0]?.options[0]).toMatchObject({ id: 'sys:Arial', system: true });
    const section = sys.at(-1);
    expect(section?.options).toEqual([
      { id: 'sys:Arial', name: { text: 'Arial' }, system: true },
      {
        id: 'sys:Secret',
        name: { text: 'Secret' },
        system: true,
        disabled: 'fonts.system.blocked.restricted',
      },
    ]);
    const none = fontSections([], { supported: true, state: 'on', ids: [], checks: {} }).at(-1);
    expect(none?.options[0]?.disabled).toBe('fonts.system.none');
  });

  it('draws a font on this computer by its own name in the editor', () => {
    expect(cssFontStack('sys:Arial')).toMatch(/^"Arial", "Triya Noto Sans Math"/u);
    expect(cssString('A "quoted" \\ name')).toBe('"A \\"quoted\\" \\\\ name"');
  });
});
