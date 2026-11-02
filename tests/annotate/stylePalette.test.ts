import { describe, expect, it } from 'vitest';
import {
  CLOUDY,
  gridMove,
  gridRows,
  isCurrent,
  MAX_FILE_BYTES,
  MAX_STYLES,
  mergeStyles,
  migrateStyles,
  moveStyle,
  nextStyleNumber,
  PALETTE_COMMANDS,
  PALETTE_TOOLS,
  parseStyles,
  presetsFor,
  sameGroup,
  serializeStyles,
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
      if (tool === 'highlight')
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
    // Highlighter tints, never a full-strength colour over the text.
    expect(presetsFor('highlight')[5]?.props).toEqual({ strokeColor: '#FFE14D', color: '#FFE14D' });
  });

  it('marks the shipped default as current: red, and yellow for the highlight', () => {
    for (const tool of STYLE_TOOLS) {
      const current = presetsFor(tool).filter((p) => isCurrent(p.props, SHIPPED_DEFAULTS[tool]));
      expect(current.map((p) => p.id)).toEqual([tool === 'highlight' ? 'yellow' : 'red']);
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
  });
});

describe('user styles', () => {
  const a: UserStyle = { id: 'a', name: 'A', props: { strokeWidth: 2 } };
  const b: UserStyle = { id: 'b', name: 'B', props: { strokeWidth: 3 } };
  const c: UserStyle = { id: 'c', name: 'C', props: { strokeWidth: 4 } };

  it('a stored record keeps its well-formed styles only', () => {
    expect(
      migrateStyles({
        v: 1,
        styles: [
          a,
          { id: 'x', name: '', props: { strokeWidth: 1 } },
          { id: 'y', name: 'Y', props: { strokeColor: 'red' } },
          { name: 'Z', props: { strokeWidth: 1 } },
          { id: 'w', name: '  W  ', props: { strokeWidth: 1, bogus: 1 } },
        ],
      }),
    ).toEqual([a, { id: 'w', name: 'W', props: { strokeWidth: 1 } }]);
    expect(migrateStyles({ v: 2, styles: [a] })).toEqual([]);
    expect(migrateStyles(null)).toEqual([]);
  });

  it('reorders by one place, clamped at the ends', () => {
    expect(moveStyle([a, b, c], 'c', -1).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(moveStyle([a, b, c], 'a', -1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(moveStyle([a, b, c], 'a', 1).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(moveStyle([a, b, c], 'zz', 1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('names a new style with the next free number', () => {
    const nameOf = (k: number) => `Style ${String(k)}`;
    expect(nextStyleNumber([], nameOf)).toBe(1);
    expect(
      nextStyleNumber(
        [
          { ...a, name: 'Style 2' },
          { ...b, name: 'Style 3' },
        ],
        nameOf,
      ),
    ).toBe(4);
  });

  it('merges an import after the existing styles, up to the limit per tool', () => {
    expect(mergeStyles({ square: [a] }, { square: [b], line: [c] })).toEqual({
      square: [a, b],
      line: [c],
    });
    const full = Array.from({ length: MAX_STYLES }, (_, i) => ({ ...a, id: String(i) }));
    expect(mergeStyles({ square: full }, { square: [b] })).toBeNull();
  });
});

describe('.pdftools-styles.json', () => {
  it('round-trips names and properties with new ids', () => {
    const text = serializeStyles({
      square: [{ id: 'a', name: 'Blue cloud', props: { strokeColor: '#0000FF', strokeWidth: 2 } }],
      highlight: [{ id: 'b', name: 'Pink', props: { strokeColor: '#FFC0CB', color: '#FFC0CB' } }],
      line: [],
    });
    expect(JSON.parse(text)).toEqual({
      format: 'pdftools-styles',
      version: 1,
      tools: {
        square: [{ name: 'Blue cloud', props: { strokeColor: '#0000FF', strokeWidth: 2 } }],
        highlight: [{ name: 'Pink', props: { strokeColor: '#FFC0CB', color: '#FFC0CB' } }],
      },
    });
    const r = parseStyles(text, newId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.count).toBe(2);
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
