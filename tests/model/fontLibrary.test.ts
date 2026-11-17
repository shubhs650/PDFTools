// The font library's registry (M11-07, D-52): the catalogue, the vendored
// files it names (built by scripts/fonts/build.ts, SHA-256 in manifest.json),
// faces with synthetic styles, the standard fallback in /DA, the family in
// /DS, and where the files are served and precached.
import { describe, expect, it } from 'vitest';
import { readFontManifest, verifyVendoredFonts } from '../../scripts/fonts/manifest.ts';
import { SOURCES } from '../../scripts/fonts/sources.ts';
import { defaultStyleString, familyFromDefaultStyle } from '../../src/model/freeTextStyle';
import {
  FALLBACK_CHAIN,
  FONT_GROUPS,
  FONT_LIBRARY,
  fontLibraryPath,
  libraryFamily,
  libraryFamilyByName,
  libraryFiles,
  PICKER_FAMILIES,
  resolveFace,
  standardFont,
  standardStyle,
} from '../../src/model/fonts/library';
import { splitPrecache } from '../../src/sw/precacheSplit';

const fam = (id: string) => {
  const f = libraryFamily(id);
  if (!f) throw new Error(id);
  return f;
};

describe('font library (M11-07, D-52)', () => {
  it('has the 26 families of the plan in nine groups, and a hidden symbol fallback', () => {
    expect(FONT_LIBRARY).toHaveLength(26);
    expect(PICKER_FAMILIES).toHaveLength(25);
    expect(new Set(FONT_LIBRARY.map((f) => f.id)).size).toBe(26);
    expect(new Set(FONT_LIBRARY.map((f) => f.name.toLowerCase())).size).toBe(26);
    for (const g of FONT_GROUPS)
      expect(
        PICKER_FAMILIES.some((f) => f.group === g),
        g,
      ).toBe(true);
    expect(fam('notosansmath').group).toBeNull();
    expect(FALLBACK_CHAIN.map((id) => fam(id).id)).toEqual([
      'notosansmath',
      'notosansdeva',
      'notosanssc',
    ]);
    // Every family has its upstream source (scripts/fonts/sources.ts).
    for (const f of FONT_LIBRARY) expect(SOURCES[f.id], f.id).toBeDefined();
  });

  it('ships every file it names, as built from the pinned sources, with every license', () => {
    expect(verifyVendoredFonts()).toEqual([]);
    const m = readFontManifest();
    expect(Object.keys(m.files).sort()).toEqual(libraryFiles());
    for (const f of Object.values(m.families)) expect(f.license).toBe('OFL-1.1');
    // Reserved Font Names (OFL §3) ship unmodified: their bold is a variation of the same file.
    expect(m.families.carlito?.reservedName).toBe('Carlito');
    expect(fam('ibmplexsans').faces.bold).toEqual({ file: 'ibmplexsans-upright.ttf', wght: 700 });
    // The measured size the owner accepted (ADR-028, S26): 16.0 MB.
    const total = Object.values(m.files).reduce((n, f) => n + f.bytes, 0);
    expect(total / 1048576).toBeGreaterThan(15.5);
    expect(total / 1048576).toBeLessThan(16.5);
  });

  it('resolves faces, and synthesizes bold or italic a family lacks', () => {
    expect(resolveFace(fam('roboto'), true, true)).toMatchObject({
      face: { file: 'roboto-boldItalic.ttf' },
      fakeBold: false,
      fakeItalic: false,
    });
    expect(resolveFace(fam('kalam'), true, true)).toMatchObject({
      face: { file: 'kalam-bold.ttf' },
      fakeBold: false,
      fakeItalic: true,
    });
    expect(resolveFace(fam('architectsdaughter'), true, false)).toMatchObject({
      face: { file: 'architectsdaughter-regular.ttf' },
      fakeBold: true,
      fakeItalic: false,
    });
    expect(resolveFace(fam('notosanssc'), false, true)).toMatchObject({
      face: { file: 'notosanssc-regular.ttf' },
      fakeItalic: true,
    });
  });

  it('maps PdfStandardFont to bold and italic and back', () => {
    for (let f = 0; f < 12; f++) {
      const { bold, italic } = standardStyle(f);
      const family = f < 4 ? 'courier' : f < 8 ? 'helvetica' : 'times';
      expect(standardFont(family, bold, italic)).toBe(f);
    }
    expect(standardStyle(undefined)).toEqual({ bold: false, italic: false });
    expect(standardStyle(13)).toEqual({ bold: false, italic: false });
  });

  it('writes the family to /DS and finds it again by name', () => {
    const ds = defaultStyleString({
      fontFamily: 6,
      fontSize: 11,
      textAlign: 1,
      color: '#123456',
      family: 'Atkinson Hyperlegible',
    });
    expect(ds).toBe(
      "font: bold italic 'Atkinson Hyperlegible' 11pt; text-align:center; color:#123456",
    );
    expect(libraryFamilyByName(familyFromDefaultStyle(ds) ?? '')?.id).toBe('atkinson');
    expect(libraryFamilyByName('"roboto"')?.id).toBe('roboto');
    expect(familyFromDefaultStyle('font: Helvetica,sans-serif 12.0pt; color:#000000')).toBe(
      'Helvetica',
    );
    expect(familyFromDefaultStyle("font-family: 'IBM Plex Mono'; font-size: 9pt")).toBe(
      'IBM Plex Mono',
    );
    expect(familyFromDefaultStyle('color:#000000')).toBeNull();
    expect(libraryFamilyByName('Helvetica')).toBeUndefined();
  });

  it('is served under fonts/lib/ and precached in the background, never at install', () => {
    const entries = [
      ...libraryFiles().map((f) => fontLibraryPath(f)),
      'fonts/lib/roboto/LICENSE',
      'assets/harfbuzz-AbC123.js',
      'assets/harfbuzz-Xy9.wasm',
      'assets/harfbuzz-subset-Xy9.wasm',
    ].map((url) => ({ url, revision: null }));
    const { core, background } = splitPrecache(entries);
    expect(core).toEqual([]);
    expect(background).toHaveLength(entries.length - 1); // the license text is not precached
  });
});
