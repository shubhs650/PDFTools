import { describe, expect, it } from 'vitest';
import {
  CLOUDY,
  cloneName,
  gridMove,
  gridRows,
  insertAfter,
  isCurrent,
  isPristine,
  MAX_FILE_BYTES,
  MAX_STYLES,
  mergeStyles,
  migrateStyles,
  moveStyle,
  PALETTE_COMMANDS,
  PALETTE_TOOLS,
  parseStyles,
  presetOf,
  presetsFor,
  resetStyle,
  restorePresets,
  sameGroup,
  seedStyles,
  serializeStyles,
  TOOL_COMMANDS,
  TOOL_GROUPS,
  type UserStyle,
} from '../../src/features/annotate/tools/stylePalette';
import { SHIPPED_DEFAULTS, STYLE_TOOLS } from '../../src/features/annotate/tools/toolDefaults';

let n = 0;
const newId = () => `id${String(++n)}`;

describe('presets (M6-07, D-37, B5)', () => {
  it('every palette tool has the seven colours, in order', () => {
    for (const tool of PALETTE_TOOLS) {
      const ids = presetsFor(tool)
        .filter((p) => !p.cloudy)
        .map((p) => p.id);
      if (['highlight', 'highlightArea', 'inkHighlighter'].includes(tool))
        expect(ids).toEqual(['red', 'purple', 'indigo', 'blue', 'green', 'yellow']);
      else expect(ids).toEqual(['red', 'purple', 'indigo', 'blue', 'green', 'yellow', 'black']);
    }
  });

  it('closed shapes add the Cloudy variants; text boxes, lines and the cloud do not', () => {
    for (const tool of ['square', 'circle', 'polygon'] as const) {
      const cloudy = presetsFor(tool).filter((p) => p.cloudy);
      expect(cloudy).toHaveLength(7);
      expect(cloudy[0]?.props).toMatchObject({
        strokeColor: '#FF0000',
        cloudyBorderIntensity: CLOUDY,
      });
      // The solid variant takes a cloudy border away.
      expect(presetsFor(tool)[0]?.props).toEqual({
        strokeColor: '#FF0000',
        cloudyBorderIntensity: 0,
      });
    }
    for (const tool of [
      'freeText',
      'freeTextCallout',
      'line',
      'cloud',
      'ink',
      'highlight',
    ] as const)
      expect(presetsFor(tool).some((p) => p.cloudy)).toBe(false);
  });

  it('sets the properties each kind of comment has', () => {
    expect(presetsFor('freeText')[3]?.props).toEqual({
      fontColor: '#0000FF',
      strokeColor: '#0000FF',
    });
    expect(presetsFor('typewriter')[3]?.props).toEqual({ fontColor: '#0000FF' });
    expect(presetsFor('lineArrow')[4]?.props).toEqual({ strokeColor: '#008000' });
    expect(presetsFor('ink')[6]?.props).toEqual({ strokeColor: '#000000', color: '#000000' });
    // Highlighter tints, never a full-strength colour over the text, at 50 % (M7-07).
    expect(presetsFor('highlight')[5]?.props).toEqual({
      strokeColor: '#FFE14D',
      color: '#FFE14D',
      opacity: 0.5,
    });
    for (const tool of ['highlight', 'highlightArea', 'inkHighlighter'] as const)
      for (const p of presetsFor(tool)) expect(p.props.opacity, `${tool} ${p.id}`).toBe(0.5);
    // The other markups and the pencil keep the opacity they have.
    for (const tool of ['underline', 'ink', 'square'] as const)
      for (const p of presetsFor(tool)) expect(p.props.opacity).toBeUndefined();
  });

  it('marks the shipped default as current: red, and yellow for the highlights', () => {
    const expected: Partial<Record<string, string[]>> = {
      highlight: ['yellow'],
      highlightArea: ['yellow'],
      // M6-17 tools keep their earlier colours, which are no preset.
      underline: [],
      strikeout: [],
      squiggly: [],
      inkHighlighter: [],
      textComment: [],
      // M7-07: black Courier.
      typewriter: ['black'],
    };
    for (const tool of STYLE_TOOLS) {
      const current = presetsFor(tool).filter((p) => isCurrent(p.props, SHIPPED_DEFAULTS[tool]));
      expect(
        current.map((p) => p.id),
        tool,
      ).toEqual(expected[tool] ?? ['red']);
    }
    expect(isCurrent({ strokeColor: '#ff0000' }, { strokeColor: '#FF0000' })).toBe(true);
    expect(isCurrent({ strokeDashArray: [] }, {})).toBe(true);
  });

  it('every split button is a style tool; restyling stays within a group', () => {
    for (const tool of Object.values(PALETTE_COMMANDS)) expect(STYLE_TOOLS).toContain(tool);
    expect(sameGroup('square', 'circle')).toBe(true);
    expect(sameGroup('cloud', 'polygon')).toBe(true);
    expect(sameGroup('line', 'lineArrow')).toBe(true);
    expect(sameGroup('freeText', 'freeTextCallout')).toBe(true);
    expect(sameGroup('freeText', 'typewriter')).toBe(false);
    expect(sameGroup('line', 'square')).toBe(false);
    expect(sameGroup('ink', 'highlight')).toBe(false);
    expect(sameGroup('underline', 'squiggly')).toBe(true);
    expect(sameGroup('highlight', 'highlightArea')).toBe(false);
  });

  it('M6-17 tools: markup colours in full, highlighter tints, note colours', () => {
    expect(presetsFor('underline')[3]?.props).toEqual({ strokeColor: '#0000FF', color: '#0000FF' });
    expect(presetsFor('highlightArea')[3]?.props).toEqual({
      color: '#9CCBFF',
      strokeColor: '#9CCBFF',
      opacity: 0.5,
    });
    expect(presetsFor('inkHighlighter')[0]?.props).toEqual({
      strokeColor: '#FF9C9C',
      color: '#FF9C9C',
      opacity: 0.5,
    });
    expect(presetsFor('textComment')[5]?.props).toEqual({ strokeColor: '#FFFF00' });
  });

  it('the window lists every style tool once, each with its ribbon command', () => {
    const listed = TOOL_GROUPS.flatMap((g) => g.tools);
    expect([...listed].sort()).toEqual([...STYLE_TOOLS].sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const tool of STYLE_TOOLS) expect(TOOL_COMMANDS[tool]).toMatch(/^comment\./);
  });
});

describe('presets as styles (M6-17)', () => {
  it('a tool starts with its presets, unnamed (their names are translated)', () => {
    const seed = seedStyles('square');
    expect(seed).toHaveLength(14);
    expect(seed[0]).toEqual({
      id: 'preset:red',
      name: '',
      props: { strokeColor: '#FF0000', cloudyBorderIntensity: 0 },
      preset: 'red',
    });
    expect(seed[7] && presetOf('square', seed[7])?.cloudy).toBe(true);
    expect(seed.every((s) => isPristine('square', s))).toBe(true);
  });

  it('migrates: nothing stored or unreadable → presets; v1 → presets, then the own styles', () => {
    const own = { id: 'a', name: 'Mine', props: { strokeWidth: 3 } };
    expect(migrateStyles(undefined, 'line')).toEqual(seedStyles('line'));
    expect(migrateStyles({ v: 9, styles: [] }, 'line')).toEqual(seedStyles('line'));
    expect(
      migrateStyles({ v: 1, styles: [own, { id: 'b', name: '', props: {} }] }, 'line'),
    ).toEqual([...seedStyles('line'), own]);
    // A v1 style cannot claim to be a preset.
    expect(migrateStyles({ v: 1, styles: [{ ...own, preset: 'red' }] }, 'line').at(-1)).toEqual(
      own,
    );
  });

  it('v2 keeps edited, renamed, reordered and deleted presets as stored', () => {
    const edited = {
      id: 'preset:blue',
      name: '',
      props: { strokeColor: '#0000AA' },
      preset: 'blue',
    };
    const renamed = {
      id: 'preset:red',
      name: 'Danger',
      props: { strokeColor: '#FF0000' },
      preset: 'red',
    };
    const own = { id: 'a', name: 'Mine', props: { strokeWidth: 3 } };
    expect(migrateStyles({ v: 2, styles: [own, edited, renamed] }, 'line')).toEqual([
      own,
      edited,
      renamed,
    ]);
    expect(migrateStyles({ v: 2, styles: [] }, 'line')).toEqual([]);
    // An unknown preset, an unnamed own style and a duplicate id are dropped.
    expect(
      migrateStyles(
        {
          v: 2,
          styles: [
            { id: 'x', name: '', props: { strokeWidth: 1 }, preset: 'pink' },
            { id: 'y', name: '', props: { strokeWidth: 1 } },
            own,
            { ...own, name: 'Again' },
          ],
        },
        'line',
      ),
    ).toEqual([own]);
  });

  it('v2 → v3 (M7-07): unchanged highlight presets move to 50 %; changed ones are kept', () => {
    // As v2 stored them: the highlight presets had no opacity.
    const v2 = (tool: 'highlight' | 'highlightArea' | 'inkHighlighter') =>
      seedStyles(tool).map((s) => {
        const props = { ...s.props };
        delete props.opacity;
        return { ...s, props };
      });
    for (const tool of ['highlight', 'highlightArea', 'inkHighlighter'] as const)
      expect(migrateStyles({ v: 2, styles: v2(tool) }, tool), tool).toEqual(seedStyles(tool));
    const [red, purple, indigo] = v2('highlight') as [UserStyle, UserStyle, UserStyle];
    // Renamed only: the look moves to 50 %, the name stays.
    const renamed = { ...red, name: 'Urgent' };
    // The user's own opacity, and the user's own colour, are kept.
    const opaque = { ...purple, props: { ...purple.props, opacity: 1 } };
    const recoloured = { ...indigo, props: { strokeColor: '#123456', color: '#123456' } };
    const own = { id: 'a', name: 'Mine', props: { strokeColor: '#FFE14D', color: '#FFE14D' } };
    expect(
      migrateStyles({ v: 2, styles: [renamed, opaque, recoloured, own] }, 'highlight'),
    ).toEqual([{ ...renamed, props: { ...red.props, opacity: 0.5 } }, opaque, recoloured, own]);
    // v3 is read as stored (no second upgrade).
    expect(migrateStyles({ v: 3, styles: [red] }, 'highlight')).toEqual([red]);
    // Other tools' v2 lists are unchanged.
    expect(migrateStyles({ v: 2, styles: seedStyles('square') }, 'square')).toEqual(
      seedStyles('square'),
    );
  });

  it('Reset brings a preset back; Reset All restores the presets and keeps the own styles', () => {
    const [red, purple] = seedStyles('line') as [UserStyle, UserStyle];
    const changed = { ...red, name: 'Danger', props: { strokeColor: '#AA0000', strokeWidth: 4 } };
    expect(isPristine('line', changed)).toBe(false);
    expect(resetStyle('line', changed)).toEqual(red);
    const own = { id: 'a', name: 'Mine', props: { strokeWidth: 3 } };
    expect(resetStyle('line', own)).toBe(own);
    expect(restorePresets('line', [own, purple])).toEqual([...seedStyles('line'), own]);
  });

  it('clone names, inserted after the source', () => {
    const nameOf = (b: string, n: number) => (n === 1 ? `${b} copy` : `${b} copy ${String(n)}`);
    expect(cloneName([], 'Red', nameOf)).toBe('Red copy');
    expect(cloneName(['Red copy', 'Red copy 2'], 'Red', nameOf)).toBe('Red copy 3');
    expect(cloneName([], 'x'.repeat(80), nameOf)).toHaveLength(64);
    const a = { id: 'a', name: 'A', props: { strokeWidth: 1 } };
    const b = { id: 'b', name: 'B', props: { strokeWidth: 2 } };
    const c = { id: 'c', name: 'C', props: { strokeWidth: 3 } };
    expect(insertAfter([a, b], 'a', c).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(insertAfter([a, b], null, c).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(insertAfter([a, b], 'zz', c).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('user styles', () => {
  const a: UserStyle = { id: 'a', name: 'A', props: { strokeWidth: 2 } };
  const b: UserStyle = { id: 'b', name: 'B', props: { strokeWidth: 3 } };
  const c: UserStyle = { id: 'c', name: 'C', props: { strokeWidth: 4 } };

  it('a stored v1 record keeps its well-formed styles only', () => {
    expect(
      migrateStyles(
        {
          v: 1,
          styles: [
            a,
            { id: 'x', name: '', props: { strokeWidth: 1 } },
            { id: 'y', name: 'Y', props: { strokeColor: 'red' } },
            { name: 'Z', props: { strokeWidth: 1 } },
            { id: 'w', name: '  W  ', props: { strokeWidth: 1, bogus: 1 } },
          ],
        },
        'square',
      ).filter((s) => !s.preset),
    ).toEqual([a, { id: 'w', name: 'W', props: { strokeWidth: 1 } }]);
  });

  it('reorders by one place, clamped at the ends', () => {
    expect(moveStyle([a, b, c], 'c', -1).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(moveStyle([a, b, c], 'a', -1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(moveStyle([a, b, c], 'a', 1).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(moveStyle([a, b, c], 'zz', 1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('merges an import after the existing styles, up to the limit per tool', () => {
    const lists: Record<string, UserStyle[]> = { square: [a] };
    const listOf = (tool: string) => lists[tool] ?? [];
    expect(mergeStyles(listOf, { square: [b], line: [c] })).toEqual({
      square: [a, b],
      line: [c],
    });
    lists.square = Array.from({ length: MAX_STYLES }, (_, i) => ({ ...a, id: String(i) }));
    expect(mergeStyles(listOf, { square: [b] })).toBeNull();
  });
});

describe('.pdftools-styles.json', () => {
  it('round-trips names and properties with new ids', () => {
    const [red, purple] = seedStyles('line') as [UserStyle, UserStyle];
    const text = serializeStyles(
      {
        square: [
          { id: 'a', name: 'Blue cloud', props: { strokeColor: '#0000FF', strokeWidth: 2 } },
        ],
        highlight: [{ id: 'b', name: 'Pink', props: { strokeColor: '#FFC0CB', color: '#FFC0CB' } }],
        // Presets as shipped stay out; a changed one goes under its shown name.
        line: [red, { ...purple, props: { strokeColor: '#800080', strokeWidth: 5 } }],
      },
      (_tool, s) => s.name || `Shown ${s.preset ?? ''}`,
    );
    expect(JSON.parse(text)).toEqual({
      format: 'pdftools-styles',
      version: 1,
      tools: {
        line: [{ name: 'Shown purple', props: { strokeColor: '#800080', strokeWidth: 5 } }],
        square: [{ name: 'Blue cloud', props: { strokeColor: '#0000FF', strokeWidth: 2 } }],
        highlight: [{ name: 'Pink', props: { strokeColor: '#FFC0CB', color: '#FFC0CB' } }],
      },
    });
    const r = parseStyles(text, newId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.count).toBe(3);
    expect(r.value.styles.square?.[0]).toMatchObject({ name: 'Blue cloud' });
    expect(r.value.styles.square?.[0]?.id).toMatch(/^id\d+$/);
  });

  const file = (tools: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ format: 'pdftools-styles', version: 1, tools, ...extra });
  const errors = (text: string) => {
    const r = parseStyles(text, newId);
    return r.ok ? [] : r.errors;
  };

  it('rejects malformed files, whole, with the reason', () => {
    expect(errors('{nope')).toEqual(['json']);
    expect(errors('[]')).toEqual(['format']);
    expect(errors(JSON.stringify({ format: 'pdftools-scheme', version: 1, tools: {} }))).toEqual([
      'format',
    ]);
    expect(errors(file({}, { version: 2 }))).toEqual(['version']);
    expect(errors(file([]))).toEqual(['format']);
    expect(errors(file({}))).toEqual(['empty']);
    expect(errors(file({ eraser: [{ name: 'A', props: { strokeWidth: 1 } }] }))).toEqual(['tool']);
    expect(errors(file({ square: [{ name: '', props: { strokeWidth: 1 } }] }))).toEqual(['style']);
    expect(errors(file({ square: [{ name: 'A', props: { strokeColor: 'red' } }] }))).toEqual([
      'style',
    ]);
    // One bad property spoils the style (no half-imported style).
    expect(
      errors(file({ square: [{ name: 'A', props: { strokeWidth: 1, script: 'x' } }] })),
    ).toEqual(['style']);
    expect(errors(file({ square: [{ name: 'A', props: {} }] }))).toEqual(['style']);
    expect(errors(file({ square: 'A' }))).toEqual(['style']);
    const many = Array.from({ length: MAX_STYLES + 1 }, () => ({
      name: 'A',
      props: { strokeWidth: 1 },
    }));
    expect(errors(file({ square: many }))).toEqual(['tooMany']);
    expect(errors(' '.repeat(MAX_FILE_BYTES + 1))).toEqual(['tooLarge']);
  });
});

describe('swatch grid keys', () => {
  // 14 presets in rows of 7, 3 user styles, then the footer item.
  const rows = gridRows([14, 3], 7, 1);

  it('lays out sections in rows, then the tail', () => {
    expect(rows).toEqual([[0, 1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13], [14, 15, 16], [17]]);
    expect(gridRows([0, 2], 7, 1)).toEqual([[0, 1], [2]]);
  });

  it('Left/Right in reading order, stopping at the ends', () => {
    expect(gridMove(rows, 6, 'ArrowRight')).toBe(7);
    expect(gridMove(rows, 7, 'ArrowLeft')).toBe(6);
    expect(gridMove(rows, 0, 'ArrowLeft')).toBe(0);
    expect(gridMove(rows, 17, 'ArrowRight')).toBe(17);
  });

  it('Up/Down keep the column, the nearest in a shorter row', () => {
    expect(gridMove(rows, 2, 'ArrowDown')).toBe(9);
    expect(gridMove(rows, 9, 'ArrowDown')).toBe(16);
    expect(gridMove(rows, 12, 'ArrowDown')).toBe(16);
    expect(gridMove(rows, 16, 'ArrowDown')).toBe(17);
    expect(gridMove(rows, 17, 'ArrowUp')).toBe(14);
    expect(gridMove(rows, 15, 'ArrowUp')).toBe(8);
    expect(gridMove(rows, 3, 'ArrowUp')).toBe(3);
    expect(gridMove(rows, 17, 'ArrowDown')).toBe(17);
  });

  it('Home/End; other keys are not moves', () => {
    expect(gridMove(rows, 9, 'Home')).toBe(0);
    expect(gridMove(rows, 9, 'End')).toBe(17);
    expect(gridMove(rows, 9, 'Enter')).toBeUndefined();
    expect(gridMove([], 0, 'ArrowDown')).toBeUndefined();
  });
});
