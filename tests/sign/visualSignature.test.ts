import { describe, expect, it } from 'vitest';
import {
  clearWhiteBackground,
  fitEdge,
  inkBounds,
  inkPath,
  keepNewest,
  MAX_SAVED_SIGNATURES,
  parseField,
  parseSignatureRecord,
  SIGNATURE_RECORD_VERSION,
  typedText,
  WHITE_CUTOFF,
  WHITE_SOFT,
  type StoredEntry,
} from '../../src/model/visualSignature';

// M6-13 (ADR-021 D-40 b): saved visual signatures are checked on the way back
// from IndexedDB, and the encoder worker's pixel steps are pure.

const ink = {
  creationType: 'draw',
  previewDataUrl: 'data:image/png;base64,AAAA',
  inkData: {
    inkList: [
      {
        points: [
          { x: 1, y: 2 },
          { x: 10, y: 12.345 },
        ],
      },
    ],
    strokeWidth: 3,
    strokeColor: '#0B3D91',
    size: { width: 120, height: 40 },
  },
};

const png = {
  creationType: 'type',
  label: 'Ada Lovelace',
  previewDataUrl: '',
  imageMimeType: 'image/png',
  imageSize: { width: 300, height: 90 },
  imageData: 'iVBORw0KGgo=',
};

const record = (entry: unknown) => ({ v: SIGNATURE_RECORD_VERSION, entry });

describe('parseField', () => {
  it('keeps a drawn field and drops its preview data URL', () => {
    expect(parseField(ink)).toEqual({ ...ink, previewDataUrl: '' });
  });

  it('keeps a typed or uploaded PNG field', () => {
    expect(parseField(png)).toEqual(png);
    expect(parseField({ ...png, creationType: 'upload', label: undefined })).toEqual({
      creationType: 'upload',
      previewDataUrl: '',
      imageMimeType: 'image/png',
      imageSize: { width: 300, height: 90 },
      imageData: 'iVBORw0KGgo=',
    });
  });

  it.each([
    ['unknown method', { ...png, creationType: 'cert' }],
    ['not PNG', { ...png, imageMimeType: 'image/svg+xml' }],
    ['no data', { ...png, imageData: '' }],
    ['not base64', { ...png, imageData: '<svg onload=x>' }],
    ['zero size', { ...png, imageSize: { width: 0, height: 10 } }],
    ['huge size', { ...png, imageSize: { width: 99999, height: 10 } }],
    ['bad colour', { ...ink, inkData: { ...ink.inkData, strokeColor: 'red' } }],
    ['no strokes', { ...ink, inkData: { ...ink.inkData, inkList: [] } }],
    [
      'one-point stroke',
      { ...ink, inkData: { ...ink.inkData, inkList: [{ points: [{ x: 1, y: 1 }] }] } },
    ],
    [
      'NaN point',
      {
        ...ink,
        inkData: {
          ...ink.inkData,
          inkList: [
            {
              points: [
                { x: 1, y: 1 },
                { x: Number.NaN, y: 1 },
              ],
            },
          ],
        },
      },
    ],
    ['bad width', { ...ink, inkData: { ...ink.inkData, strokeWidth: -1 } }],
    ['not an object', 'draw'],
  ])('refuses %s', (_name, v) => {
    expect(parseField(v)).toBeNull();
  });

  it('drops an over-long label but keeps the field', () => {
    expect(parseField({ ...png, label: 'x'.repeat(65) })).not.toHaveProperty('label');
  });
});

describe('parseSignatureRecord', () => {
  const entry = { id: 'e1', createdAt: 1700000000000, signature: ink, initials: png };

  it('reads a record with signature and initials', () => {
    expect(parseSignatureRecord(record(entry))).toEqual({
      id: 'e1',
      createdAt: 1700000000000,
      signature: { ...ink, previewDataUrl: '' },
      initials: png,
    });
  });

  it('reads one without initials', () => {
    expect(parseSignatureRecord(record({ ...entry, initials: undefined }))).not.toHaveProperty(
      'initials',
    );
  });

  it.each([
    ['another version', { v: 2, entry }],
    ['no entry', { v: SIGNATURE_RECORD_VERSION }],
    ['bad id', record({ ...entry, id: '' })],
    ['bad time', record({ ...entry, createdAt: 'yesterday' })],
    ['damaged signature', record({ ...entry, signature: { ...png, imageData: 7 } })],
    ['damaged initials', record({ ...entry, initials: { creationType: 'draw' } })],
    ['null', null],
  ])('skips %s', (_name, v) => {
    expect(parseSignatureRecord(v)).toBeNull();
  });
});

describe('keepNewest', () => {
  it(`keeps the ${String(MAX_SAVED_SIGNATURES)} newest, newest first`, () => {
    const signature = parseField(ink);
    if (!signature) throw new Error('fixture');
    const many: StoredEntry[] = Array.from({ length: MAX_SAVED_SIGNATURES + 2 }, (_, i) => ({
      id: `e${String(i)}`,
      createdAt: i,
      signature,
    }));
    const { kept, dropped } = keepNewest(many);
    expect(kept.map((e) => e.id)[0]).toBe(`e${String(MAX_SAVED_SIGNATURES + 1)}`);
    expect(kept).toHaveLength(MAX_SAVED_SIGNATURES);
    expect(dropped.sort()).toEqual(['e0', 'e1']);
  });
});

describe('typedText', () => {
  it('tidies spaces and cuts to the limit (by characters)', () => {
    expect(typedText('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(typedText('ÅÅÅÅÅÅ', 5)).toBe('ÅÅÅÅÅ');
    expect(typedText('   ')).toBeNull();
  });
});

describe('clearWhiteBackground', () => {
  const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

  it('makes white and near-white clear, keeps ink, fades the edge', () => {
    const mid = Math.round((WHITE_CUTOFF + WHITE_SOFT) / 2);
    const data = px(
      255,
      255,
      255,
      255, // paper
      WHITE_CUTOFF,
      250,
      250,
      255, // still paper
      20,
      20,
      60,
      255, // ink
      mid,
      mid,
      mid,
      255, // anti-aliased edge
      250,
      250,
      40,
      255, // yellow: one dark channel, kept
    );
    clearWhiteBackground(data);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(0);
    expect(data[11]).toBe(255);
    expect(data[15]).toBeGreaterThan(0);
    expect(data[15]).toBeLessThan(255);
    expect(data[19]).toBe(255);
    // Colours are left alone.
    expect([...data.slice(8, 11)]).toEqual([20, 20, 60]);
  });
});

describe('inkBounds', () => {
  it('finds the visible pixels, padded and kept inside the image', () => {
    const w = 10;
    const h = 6;
    const data = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number) => {
      data[(y * w + x) * 4 + 3] = 255;
    };
    set(3, 2);
    set(6, 4);
    expect(inkBounds(data, w, h, 1)).toEqual({ x: 2, y: 1, width: 6, height: 5 });
    expect(inkBounds(data, w, h, 10)).toEqual({ x: 0, y: 0, width: 10, height: 6 });
  });

  it('is null for an empty (or faint) image', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(5);
    expect(inkBounds(data, 4, 4)).toBeNull();
  });
});

describe('fitEdge', () => {
  it('scales the longest edge down, never up', () => {
    expect(fitEdge({ width: 2400, height: 600 }, 1200)).toEqual({ width: 1200, height: 300 });
    expect(fitEdge({ width: 300, height: 100 }, 1200)).toEqual({ width: 300, height: 100 });
  });
});

describe('inkPath', () => {
  it('draws each stroke as a move then lines, rounded to 0.1 px', () => {
    expect(inkPath(ink.inkData)).toBe('M1 2 L10 12.3');
  });
});
