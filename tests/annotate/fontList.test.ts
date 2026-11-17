// The comment font list (M11-07, D-52): sections, Recently used, type-ahead,
// the editor's CSS stack and tool defaults keeping a library font.
import { describe, expect, it } from 'vitest';
import { fontOption, fontSections, typeahead } from '../../src/features/annotate/fonts/fontList';
import { RECENT_FONTS_MAX, withRecent } from '../../src/features/annotate/fonts/recentFonts';
import { cssFontStack } from '../../src/features/annotate/fonts/commentFonts';
import { cleanProps } from '../../src/features/annotate/tools/toolDefaults';
import { isCommentFont } from '../../src/features/annotate/properties/model';

describe('comment font list (M11-07)', () => {
  it('lists Recently used, Standard, then the library groups in the plan order', () => {
    const s = fontSections(['roboto', 'times', 'nope', 'notosansmath']);
    expect(s.map((x) => x.id)).toEqual([
      'recent',
      'standard',
      'office',
      'sans',
      'narrow',
      'technical',
      'serif',
      'mono',
      'hand',
      'hindi',
      'chinese',
    ]);
    expect(s[0]?.options.map((o) => o.id)).toEqual(['roboto', 'times']);
    expect(s[1]?.options.map((o) => o.id)).toEqual(['helvetica', 'times', 'courier']);
    expect(s[2]?.options.map((o) => o.id)).toEqual(['arimo', 'tinos', 'cousine', 'carlito']);
    expect(fontSections([]).map((x) => x.id)[0]).toBe('standard');
    const all = s.slice(1).flatMap((x) => x.options);
    expect(all).toHaveLength(28);
    expect(fontOption('notosanssc')).toMatchObject({
      name: { text: 'Noto Sans SC' },
      sample: '中文',
    });
    expect(fontOption('helvetica')).toMatchObject({ name: { key: 'annotProps.font.helvetica' } });
    expect(fontOption('notosansmath')).toBeNull();
  });

  it('keeps the five fonts chosen last, newest first', () => {
    let r: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) r = withRecent(r, id);
    expect(r).toEqual(['c', 'f', 'e', 'd', 'b']);
    expect(r).toHaveLength(RECENT_FONTS_MAX);
  });

  it('jumps to a name as it is typed, and cycles on a repeated letter', () => {
    const names = [
      'Helvetica',
      'Times',
      'Courier',
      'Roboto',
      'Roboto Mono',
      'Roboto Condensed',
      'Noto Serif',
    ];
    expect(typeahead(names, 'r', 0)).toBe(3);
    expect(typeahead(names, 'roboto c', 3)).toBe(5);
    expect(typeahead(names, 'rr', 3)).toBe(4);
    expect(typeahead(names, 'rrr', 4)).toBe(5);
    expect(typeahead(names, 'n', 6)).toBe(6);
    expect(typeahead(names, 'tí', 0)).toBe(1);
    expect(typeahead(names, 'z', 0)).toBe(-1);
  });

  it('draws the editor in the face, then the same fallbacks as the appearance', () => {
    expect(cssFontStack('roboto')).toBe(
      '"Triya Roboto", "Triya Noto Sans Math", "Triya Noto Sans Devanagari", "Triya Noto Sans SC", Helvetica, Arial, sans-serif',
    );
    expect(cssFontStack('notosanssc')).not.toContain('"Triya Noto Sans SC", "Triya Noto Sans SC"');
    expect(cssFontStack('courier')).toBe('"Courier New", Courier, monospace');
  });

  it('keeps a library font in tool defaults and styles, and nothing unknown', () => {
    expect(cleanProps({ libraryFont: 'roboto', fontFamily: 5 })).toEqual({
      libraryFont: 'roboto',
      fontFamily: 5,
    });
    expect(cleanProps({ libraryFont: '' })).toEqual({ libraryFont: '' });
    expect(cleanProps({ libraryFont: 'comic' })).toEqual({});
    expect(cleanProps({ libraryFont: 'notosansmath' })).toEqual({});
    expect(isCommentFont('courier')).toBe(true);
    expect(isCommentFont('kalam')).toBe(true);
    expect(isCommentFont('comic')).toBe(false);
  });
});
