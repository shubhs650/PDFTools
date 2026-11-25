// Spike S34 (M14-01, D-74, ADR-035 Amendment 1): the findings kept as tests.
// The pack is built once on the app's own engine (PDFium, EmbedPDF, SaveTracker,
// the comment-font pipeline) and checked with the Work worker's object reader.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- corpus points known to exist (spike code) */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { measureManifest, measureSheetPath } from '../../e2e/fixtures/measure-corpus/index.ts';
import { measureSheets } from '../../e2e/fixtures/measure-corpus/sheets.ts';
import { unitsPerPoint } from '../../src/model/scale.ts';
import { check, type CheckReport } from './check.ts';
import { engine } from './engine.ts';
import {
  areaLabelPoint,
  circleFrom3,
  corners,
  fingerprint,
  inside,
  insideAngle,
  lineCaption,
  netArea,
  readableAngle,
} from './geometry.ts';
import { buildPack, type PackResult } from './pack.ts';

let pack: PackResult;
let report: CheckReport;

beforeAll(async () => {
  const e = await engine();
  pack = await buildPack(e);
  report = await check(e, pack);
}, 60_000);

const proposals = () => pack.items.filter((i) => i.variant === 'proposal');
const markup = (id: string) => report.markups.find((m) => m.nm === id);

describe('S34: every measurement kind as one markup', () => {
  it('saves each measurement as exactly one annotation, the value in /Contents', () => {
    expect(report.oneEach.every((x) => x.found === 1)).toBe(true);
    for (const i of pack.items.filter((x) => x.variant !== 'v1.1.0')) {
      const m = markup(i.id);
      expect(m?.contents, i.id).toBe(i.contents);
      expect(m?.hasAppearance, i.id).toBe(true);
      expect(m?.irt, i.id).toBe(false);
    }
  });

  it('uses the standard measurement types where they exist (/IT and /Measure)', () => {
    const want: Record<string, [string, string]> = {
      Length: ['Line', 'LineDimension'],
      Polylength: ['PolyLine', 'PolyLineDimension'],
      Perimeter: ['PolyLine', 'PolyLineDimension'],
      Area: ['Polygon', 'PolygonDimension'],
      Volume: ['Polygon', 'PolygonDimension'],
      Cutout: ['Polygon', 'PolygonDimension'],
    };
    for (const i of proposals()) {
      const w = want[i.tool];
      if (!w) continue;
      const m = markup(i.id);
      expect([m?.subtype, m?.intent, m?.hasMeasure], i.id).toEqual([w[0], w[1], true]);
    }
    // Kinds with no standard measurement type are Stamps (their appearance is never redrawn).
    for (const i of proposals().filter((x) =>
      ['Angle', 'Radius', 'Diameter', 'Count'].includes(x.tool),
    ))
      expect(markup(i.id)?.subtype, i.id).toBe('Stamp');
  });

  it('draws every caption in an embedded font that ships with the app (no standard fonts)', () => {
    for (const i of pack.items.filter((x) => x.variant !== 'v1.1.0')) {
      const m = markup(i.id);
      expect(m?.fonts.embedded, i.id).toBeGreaterThan(0);
      expect(m?.fonts.standard, i.id).toBe(0);
    }
  });

  it('a Perimeter closes: its last vertex is its first', () => {
    const i = pack.items.find((x) => x.tool === 'Perimeter');
    const pts = markup(i?.id ?? '')?.points ?? [];
    expect(pts.length).toBeGreaterThan(3);
    expect(pts[0]?.x).toBeCloseTo(pts[pts.length - 1]?.x ?? NaN, 2);
    expect(pts[0]?.y).toBeCloseTo(pts[pts.length - 1]?.y ?? NaN, 2);
  });

  it('keeps the values of the measure corpus', () => {
    const v = (tool: string, i = 0) =>
      proposals().filter((x) => x.tool === tool)[i]?.contents ?? '';
    expect(v('Length', 0)).toBe('24,000 mm');
    expect(v('Length', 1)).toBe('10,817 mm');
    expect(v('Polylength', 0)).toBe('23,000 mm');
    expect(v('Perimeter')).toBe('Office: 30,000 mm');
    expect(v('Area')).toBe('Workshop: 114.00 m²');
    expect(v('Volume')).toBe('Slab S1: 17.69 m³');
    expect(v('Polylength', 1)).toBe('Line 150-P-101: 15,000 mm');
    expect(v('Angle', 0)).toBe('∠ 142.5°');
    expect(v('Angle', 1)).toBe('∠ 37.5°');
    expect(v('Radius', 0)).toBe('R 1,200 mm');
    expect(v('Diameter')).toBe('Ø 3,000 mm');
  });
});

describe('S34: the Triya data in the page /PieceInfo', () => {
  it('writes /PieceInfo /TriyaPDF and /LastModified on every page that has measurements', () => {
    expect(report.pieceInfoPages).toEqual([0, 1, 2]);
    expect(report.lastModifiedPages).toEqual([0, 1, 2]);
  });

  it('reads every measurement back whole while its geometry is unchanged', () => {
    expect(report.readFull.length).toBe(pack.items.filter((i) => i.variant !== 'v1.1.0').length);
    expect(report.readFull.every((r) => r.state === 'full')).toBe(true);
    const cut = report.readFull.find((r) => r.tool === 'Volume');
    expect(cut?.kept).toEqual(expect.arrayContaining(['holes', 'depth', 'label']));
  });

  it('after a move in another editor keeps tool, label, group and depth and drops holes and arcs', () => {
    expect(report.readMoved.every((r) => r.state === 'moved elsewhere')).toBe(true);
    const vol = report.readMoved.find((r) => r.tool === 'Volume');
    expect(vol?.dropped).toEqual(['holes']);
    expect(vol?.kept).toEqual(expect.arrayContaining(['depth', 'label']));
    const count = report.readMoved.find((r) => r.tool === 'Count');
    expect(count?.kept).toEqual(expect.arrayContaining(['group', 'number', 'shape']));
  });

  it('without the data reads the standard kinds back from /IT and the geometry alone', () => {
    const by = new Map(report.readNoData.map((r) => [r.nm, r.tool]));
    for (const i of proposals()) {
      const want =
        i.tool === 'Volume' || i.tool === 'Cutout'
          ? 'Area'
          : ['Length', 'Polylength', 'Perimeter', 'Area'].includes(i.tool)
            ? i.tool
            : null;
      expect(by.get(i.id), `${i.tool} ${i.id}`).toBe(want);
    }
  });

  it('survives a later Ctrl+S that rewrites the pages', () => {
    expect(report.secondSave.entriesAfter).toBe(report.secondSave.entriesBefore);
    expect(report.secondSave.entriesBefore).toBe(40);
  });
});

describe('S34: appearances', () => {
  it('keeps a Stamp exactly as drawn when a viewer redraws markups from their dictionaries', () => {
    // Ink is counted inside each Stamp's /Rect; a Stamp that overlaps a redrawn
    // Line, PolyLine or Polygon would also count that markup's lost caption.
    const overlaps = (a: number[], b: number[]) =>
      (a[0] ?? 0) < (b[2] ?? 0) &&
      (b[0] ?? 0) < (a[2] ?? 0) &&
      (a[1] ?? 0) < (b[3] ?? 0) &&
      (b[1] ?? 0) < (a[3] ?? 0);
    const redrawn = pack.items.filter((x) => x.subtype !== 'Stamp' && x.variant !== 'v1.1.0');
    let n = 0;
    for (const r of report.redraw) {
      const i = pack.items.find((x) => x.id === r.id);
      if (i?.subtype !== 'Stamp') continue;
      if (redrawn.some((o) => o.page === i.page && overlaps(o.rect, i.rect))) continue;
      n++;
      expect(r.inkAfter, r.id).toBe(r.inkBefore);
    }
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('cuts the holes out of a Cutout or Volume fill (even-odd)', () => {
    // The Volume on page 1: a hole's centre stays white, the slab around it is tinted.
    const pic = report.redrawPictures[0]?.before;
    const slab = measureManifest().sheets[0]?.items.find((x) => x.id === 'slab-volume');
    expect(pic && slab?.holes?.[1]).toBeTruthy();
    if (!pic || !slab?.holes?.[1]) return;
    const h = 841.89;
    const px = (x: number, y: number): [number, number, number] => {
      const o = (Math.round((h - y) * 2) * pic.width + Math.round(x * 2)) * 4;
      return [pic.rgba[o] ?? 0, pic.rgba[o + 1] ?? 0, pic.rgba[o + 2] ?? 0];
    };
    const hole = slab.holes[1];
    const cx = (hole[0]![0] + hole[2]![0]) / 2 - 10;
    const cy = (hole[0]![1] + hole[2]![1]) / 2;
    const [hr, hg, hb] = px(cx, cy);
    expect(hr > 245 && hg > 245 && hb > 245).toBe(true);
    const [sr, sg] = px(hole[0]![0] - 15, cy);
    expect(sr - sg).toBeGreaterThan(15);
  });
});

describe('S34 geometry', () => {
  it('finds the circle through three points; none when they are in a line', () => {
    const c = circleFrom3({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 });
    expect(c?.c.x).toBeCloseTo(0, 9);
    expect(c?.c.y).toBeCloseTo(0, 9);
    expect(c?.r).toBeCloseTo(10, 9);
    expect(circleFrom3({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(circleFrom3({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it('measures the inside angle, and none at a corner of no length', () => {
    expect(insideAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 9);
    expect(insideAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0.0001 })).toBeCloseTo(180, 1);
    expect(Number.isNaN(insideAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }))).toBe(true);
  });

  it('nets out holes and keeps an area caption out of them', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const hole = [
      { x: 30, y: 30 },
      { x: 70, y: 30 },
      { x: 70, y: 70 },
      { x: 30, y: 70 },
    ];
    expect(netArea(sq, [hole])).toBe(10000 - 1600);
    const p = areaLabelPoint(sq, [hole], 20, 8);
    expect(inside(p, sq)).toBe(true);
    for (const q of corners({ at: p, angle: 0, width: 20, height: 8 }))
      expect(inside(q, hole)).toBe(false);
  });

  it('turns captions to read left to right and puts Above on the reading side', () => {
    expect(readableAngle({ x: 10, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0, 9);
    expect(readableAngle({ x: 0, y: 10 }, { x: 0, y: 0 })).toBeCloseTo(Math.PI / 2, 9);
    const c = lineCaption({ x: 100, y: 0 }, { x: 0, y: 0 }, 'above', 40, 10, 1.5);
    expect(c.at.y).toBeCloseTo(6.5, 9);
  });

  it('fingerprints geometry to 0.01 pt', () => {
    expect(fingerprint([1.001, 2])).toBe(fingerprint([1.004, 2]));
    expect(fingerprint([1.001, 2])).not.toBe(fingerprint([1.02, 2]));
  });
});

describe('measure corpus (M14-01)', () => {
  it('is up to date with its generator', () => {
    for (const s of measureSheets())
      expect(
        Buffer.from(readFileSync(measureSheetPath(s.file))).equals(Buffer.from(s.bytes)),
        s.file,
      ).toBe(true);
  });

  it('has true lengths that match the points at the sheet scale', () => {
    const k = unitsPerPoint({ paper: 1, real: 100, unit: 'mm', precision: 0 });
    const s1 = measureManifest().sheets[0];
    for (const id of ['overall-length', 'office-diagonal']) {
      const i = s1?.items.find((x) => x.id === id);
      const [a, b] = i?.points ?? [];
      expect(Math.hypot(b![0] - a![0], b![1] - a![1]) * k).toBeCloseTo(i?.value ?? NaN, 0);
    }
  });
});
