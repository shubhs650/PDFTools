// M12-14 (D-61): the corpus acceptance suite for drawings starts here. The
// differences on the overlay corpus through the whole pipeline: Work worker
// material on real PDFium, the Compare worker's handlers (alignment, banded
// detection, the text layer, entries) and the session. Every expectation is
// the manifest's: identical pairs report nothing, the control sheets are
// unchanged, the changes named are found, text-aware where there is text, and
// a title-block-only change stays inside the title block.
// M12-23 completes it: every overlay pair of the corpus (01 … 19), each
// manifest difference named, with the control sheets and the pairs that
// differ only in how they are stored (colour against monochrome, layers,
// page boxes, encryption, /Rotate) reporting nothing else.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CORPUS_PASSWORDS,
  corpusBytes,
  corpusPair,
} from '../../e2e/fixtures/comparison-corpus/index';
import { CompareClient } from '../../src/engine/compareClient';
import { CompareSession, oneFile, type SheetPair } from '../../src/features/compare/engine/session';
import type { DiffEntry, SheetDiff, Sensitivity } from '../../src/model/compare/detect/entries';
import { compareSpawn, fakeWork } from './support/inProcess';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

const opened = new Set<string>();
async function open(pair: string): Promise<void> {
  if (opened.has(pair)) return;
  opened.add(pair);
  const p = corpusPair('overlay', pair);
  for (const side of ['old', 'new'] as const) {
    const password = CORPUS_PASSWORDS[side === 'old' ? p.oldFile : p.newFile]?.user;
    await native
      .openDocumentBuffer(
        { id: `d${pair}${side}`, content: corpusBytes(p, side).slice().buffer },
        { normalizeRotation: true, ...(password ? { password } : {}) },
      )
      .toPromise();
  }
}

/** The differences of a corpus pair, sheet by sheet, at a sensitivity. */
async function differences(
  pair: string,
  o: { pairs?: SheetPair[]; sensitivity?: Sensitivity } = {},
): Promise<SheetDiff[]> {
  await open(pair);
  const p = corpusPair('overlay', pair);
  const pages = (n: number): number[] => [...Array(n).keys()];
  const s = new CompareSession(
    oneFile(`d${pair}old`, pages(p.oldPages)),
    oneFile(`d${pair}new`, pages(p.newPages)),
    {
      work: fakeWork(mod, native, []),
      compare: new CompareClient({ spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports) }),
      ...(o.pairs ? { pairs: o.pairs } : {}),
    },
  );
  try {
    await s.start();
    await s.whenDone();
    expect(s.progress().failed).toBe(0);
    const sheets = (o.pairs ?? pages(Math.min(p.oldPages, p.newPages))).map((_, sheet) => sheet);
    for (const sheet of sheets) expect(s.isDetected(sheet)).toBe(true);
    const res = await s.differences(
      sheets.map((sheet) => ({ sheet, zones: [] })),
      { sensitivity: o.sensitivity ?? 'normal', minSize: 0 },
    );
    return res.sort((x, y) => x.sheet - y.sheet).map((r) => r.diff);
  } finally {
    await s.close();
  }
}

const words = (e: DiffEntry): string => `${e.old} → ${e.new}`;
const has = (d: SheetDiff, re: RegExp): boolean => d.entries.some((e) => re.test(words(e)));

describe('differences on the overlay corpus (M12-14)', () => {
  it('pair 16: an identical pair reports nothing, at every sensitivity', async () => {
    for (const sensitivity of ['normal', 'high'] as const) {
      const d = await differences('16', { sensitivity });
      expect(d).toHaveLength(2);
      for (const sheet of d) {
        expect(sheet.entries).toEqual([]);
        expect(sheet.percent).toBe(0);
      }
    }
  }, 120_000);

  it('pair 15: the same drawing plotted at A1 and at A3 reports nothing', async () => {
    const [d] = await differences('15');
    expect(d?.entries).toEqual([]);
  }, 120_000);

  it('pair 01: every manifest change, text-aware', async () => {
    const [d] = await differences('01');
    if (!d) throw new Error('no sheet');
    expect(d.scan).toBe(false);
    expect(d.entries.length).toBeGreaterThan(20);
    expect(d.percent).toBeGreaterThan(0);
    // Bolt circle Ø120 → Ø128, bore tolerance H7 → H6, the keyway added.
    expect(has(d, /Ø120\.0 → Ø128\.0/)).toBe(true);
    expect(has(d, /H7 .*→ H6/)).toBe(true);
    expect(d.entries.some((e) => e.kind === 'added' && e.new.includes('KEYWAY'))).toBe(true);
    // Six holes become eight: geometry, not text.
    expect(d.entries.filter((e) => e.type === 'geometry').length).toBeGreaterThan(5);
    for (const e of d.entries) {
      expect(e.box[2]).toBeGreaterThan(e.box[0]);
      expect(e.box[3]).toBeGreaterThan(e.box[1]);
    }
  }, 120_000);

  it('pair 10: the identical control sheet is unchanged; the others changed', async () => {
    const d = await differences('10');
    expect(d).toHaveLength(4);
    expect(d[1]?.entries).toEqual([]);
    expect(d[1]?.percent).toBe(0);
    for (const i of [0, 2, 3]) expect(d[i]?.entries.length).toBeGreaterThan(0);
    // P4: EF-03 added.
    expect(d[3] && has(d[3], /EF-03/)).toBe(true);
  }, 180_000);

  it('pair 18: a title-block-only change stays in the title block', async () => {
    const [d] = await differences('18');
    if (!d) throw new Error('no sheet');
    expect(d.entries.length).toBeGreaterThan(0);
    // A1 landscape (2384 × 1684 pt); the title block is zones H10 – G12.
    for (const e of d.entries) {
      expect(e.box[0]).toBeGreaterThan(2384 * 0.75);
      expect(e.box[1]).toBeGreaterThan(1684 * 0.8);
    }
    expect(has(d, /2026-09-20 → 2026-10-15/)).toBe(true);
    expect(has(d, /APPROVAL → CONSTRUCTION/)).toBe(true);
  }, 120_000);

  it('pair 17: in the manifest pairing, only S-104 changed', async () => {
    const pairs: SheetPair[] = [
      { a: 0, b: 0 },
      { a: 1, b: 1 },
      { a: 3, b: 2 },
      { a: 4, b: 4 },
      { a: 5, b: 3 },
    ];
    const d = await differences('17', { pairs });
    for (const i of [0, 1, 3, 4]) expect(d[i]?.entries).toEqual([]);
    const s104 = d[2];
    if (!s104) throw new Error('no S-104');
    expect(has(s104, /W310x39 → W410x60/)).toBe(true);
  }, 180_000);

  it('pair 06: a scan is compared by its ink alone', async () => {
    const [d] = await differences('06');
    if (!d) throw new Error('no sheet');
    expect(d.scan).toBe(true);
    expect(d.entries.length).toBeGreaterThan(0);
    for (const e of d.entries) expect(e.type).toBe('geometry');
  }, 120_000);

  // M12-23: the rest of the corpus.
  const geometry = (d: SheetDiff, kind?: DiffEntry['kind']): number =>
    d.entries.filter((e) => e.type === 'geometry' && (!kind || e.kind === kind)).length;
  /** Revision letter and issue date in the title block: in every changed sheet of the corpus. */
  const titleBlock = (e: DiffEntry): boolean =>
    /^(A → B|C → D|\d{4}-\d\d-\d\d → \d{4}-\d\d-\d\d)$/u.test(words(e));
  const sheetsOf = async (pair: string, n: number, o: Parameters<typeof differences>[1] = {}) => {
    const d = await differences(pair, o);
    expect(d).toHaveLength(n);
    return d as [SheetDiff, ...SheetDiff[]];
  };
  const at = (d: SheetDiff[], i: number): SheetDiff => {
    const s = d[i];
    if (!s) throw new Error(`no sheet ${String(i)}`);
    return s;
  };

  it('pair 02: the wall shift, the new partition and door D-07, W-02 and the schedule', async () => {
    const d = await sheetsOf('02', 2);
    const p1 = at(d, 0);
    expect(geometry(p1, 'removed')).toBeGreaterThan(0);
    expect(geometry(p1, 'added')).toBeGreaterThan(0);
    expect(has(p1, /104B IT CLOSET/)).toBe(true);
    expect(has(p1, /D-07/)).toBe(true);
    expect(has(p1, /104A STORAGE/)).toBe(true);
    expect(has(p1, /W-02/)).toBe(true);
    const p2 = at(d, 1);
    expect(has(p2, /→ D-07 900 2100/)).toBe(true);
    expect(has(p2, /INWARD RIGHT — STORAGE → OUTWARD \(REVISED\)/)).toBe(true);
    expect(has(p2, /W-02/)).toBe(true);
  }, 120_000);

  it('pair 03: a registration shift and a 98.2 % plot report only the drawn changes', async () => {
    const d = await sheetsOf('03', 3);
    expect(has(at(d, 0), /F-2B \(1800x1800\) → F-2B \(2200x2200\)/)).toBe(true);
    expect(has(at(d, 0), /NEW PIER P-5/)).toBe(true);
    expect(has(at(d, 1), /W310x39 \(ADDED\)/)).toBe(true);
    expect(has(at(d, 1), /X-BRACE/)).toBe(true);
    expect(has(at(d, 2), /^4x → 6x$/)).toBe(true);
    expect(has(at(d, 2), /^150 → 125$/)).toBe(true);
    // The shift and the scale are aligned away: no sheet is changed all over.
    for (const s of d) expect(s.percent).toBeLessThan(10);
  }, 120_000);

  it('pair 04: the skewed sheet and the /Rotate 90 sheet report only their changes', async () => {
    const d = await sheetsOf('04', 2);
    const p1 = at(d, 0);
    expect(has(p1, /CB-04 \(ADDED\)/)).toBe(true);
    expect(has(p1, /Ø300 → Ø450/)).toBe(true);
    expect(has(p1, /MH-03/)).toBe(true);
    // B's sheet is stored landscape with /Rotate 90; its words read as A's (M12-23: before,
    // every word of B came apart letter by letter and the title block was all "changed").
    const p2 = at(d, 1);
    expect(has(p2, /BEDDING 150 → BEDDING 200/)).toBe(true);
    for (const e of p2.entries) expect(titleBlock(e) || words(e).includes('BEDDING')).toBe(true);
  }, 120_000);

  it('pair 05: in the manifest pairing (B inserts a sheet), every change on the three pairs', async () => {
    const pairs: SheetPair[] = [
      { a: 0, b: 0 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
    ];
    const d = await sheetsOf('05', 3, { pairs });
    expect(has(at(d, 0), /2400 ±1\.0 → 2600 ±1\.0/)).toBe(true);
    expect(has(at(d, 0), /MOTOR MOUNT PLATE/)).toBe(true);
    expect(has(at(d, 1), /6mm ALL-AROUND → 8mm STAGGERED/)).toBe(true);
    expect(geometry(at(d, 1), 'added')).toBeGreaterThan(0);
    expect(has(at(d, 2), /GUSSET PLATE/)).toBe(true);
    expect(has(at(d, 2), /212\.0 kg/)).toBe(true);
    expect(has(at(d, 2), /^2400mm → 2600mm$/)).toBe(true);
  }, 120_000);

  it('pair 07: colour against monochrome is not a change; the duct, sprinklers and LP-2 are', async () => {
    const d = await sheetsOf('07', 2);
    const p1 = at(d, 0);
    expect(geometry(p1, 'added')).toBeGreaterThanOrEqual(2);
    expect(geometry(p1, 'removed') + geometry(p1, 'changed')).toBeGreaterThan(0);
    expect(p1.entries.length).toBeLessThan(10);
    const p2 = at(d, 1);
    expect(has(p2, /PANEL LP-2/)).toBe(true);
    for (const e of p2.entries) expect(titleBlock(e) || words(e).includes('LP-2')).toBe(true);
  }, 120_000);

  it('pair 08: hairlines and 5.5 pt micro-text: every tag, spec and row edit', async () => {
    const d = await sheetsOf('08', 3);
    const p1 = at(d, 0);
    expect(has(p1, /^XV-104 → XV-104A$/)).toBe(true);
    expect(has(p1, /6"-CS-150-P1 → 8"-SS-300-P1/)).toBe(true);
    expect(has(p1, /^12\.5 → 14\.0$/)).toBe(true);
    expect(has(p1, /PT-201/)).toBe(true);
    expect(geometry(p1)).toBeGreaterThan(0); // CV-105's arrow
    expect(has(at(d, 1), /XV-104 DN150 PN25 CS → XV-104A DN200 PN40 SS/)).toBe(true);
    expect(has(at(d, 1), /DN150 PN25 CS → DN100 PN40 SS/)).toBe(true);
    expect(has(at(d, 2), /\+4\.500m → \+4\.850m/)).toBe(true);
    expect(has(at(d, 2), /^DN150 → DN200$/)).toBe(true);
  }, 120_000);

  it('pair 09: a larger MediaBox and unflattened comments are not changes; stem and weep holes are', async () => {
    const d = await sheetsOf('09', 2);
    expect(has(at(d, 0), /^350 → 400$/)).toBe(true);
    expect(has(at(d, 0), /^2000 → 1500$/)).toBe(true);
    expect(at(d, 0).entries.length).toBeLessThan(6);
    expect(has(at(d, 1), /^2000 → 1500$/)).toBe(true);
    expect(geometry(at(d, 1), 'added')).toBeGreaterThan(0);
    expect(geometry(at(d, 1), 'removed')).toBeGreaterThan(0);
  }, 120_000);

  it('pair 11: layers as each file shows them: fire protection on, the duct shifted, REV_CLOUDS added', async () => {
    const d = await sheetsOf('11', 2);
    expect(geometry(at(d, 0), 'added')).toBeGreaterThan(0);
    expect(geometry(at(d, 0), 'changed')).toBeGreaterThan(0);
    expect(has(at(d, 0), /REV B: DUCT SHIFTED/)).toBe(true);
    expect(has(at(d, 1), /REV_CLOUDS/)).toBe(true);
    expect(has(at(d, 1), /→ ON \| Sprinkler mains/)).toBe(true);
  }, 120_000);

  it('pair 12: owner-locked A against AES-256 B: girder, pier cap, bearings, concrete grade', async () => {
    const d = await sheetsOf('12', 2);
    expect(has(at(d, 0), /1200 mm → .*1400 mm/)).toBe(true);
    expect(has(at(d, 0), /^2400 → 2700$/)).toBe(true);
    expect(has(at(d, 0), /^\(4 → \(6$/)).toBe(true);
    expect(has(at(d, 1), /M40 .*→ M50/)).toBe(true);
    expect(has(at(d, 1), /^4 → 6$/)).toBe(true);
  }, 120_000);

  it('pair 13: ARCH D and E sheets: the expansion, road, pond, skylight and crane beam', async () => {
    const d = await sheetsOf('13', 2);
    expect(has(at(d, 0), /\(EXPANDED\)/)).toBe(true);
    expect(has(at(d, 0), /6\.5m WIDE\) → .*9\.0m WIDE\)/)).toBe(true);
    expect(has(at(d, 0), /DETENTION POND/)).toBe(true);
    expect(has(at(d, 1), /SKYLIGHT OPENING \(6\.0m x 4\.0m\)/)).toBe(true);
    expect(has(at(d, 1), /CRANE RAIL BEAM/)).toBe(true);
  }, 120_000);

  it('pair 14: the dense A1 sheet, all text as curves: changes are geometry, in their zones', async () => {
    const [d] = await sheetsOf('14', 1);
    // A1 landscape, 2384 × 1684 pt; the title block is at the bottom right.
    expect(d.entries.length).toBeGreaterThan(4);
    for (const e of d.entries) expect(e.type).toBe('geometry');
    expect(geometry(d, 'removed')).toBeGreaterThan(0); // pad P-1505
    expect(geometry(d, 'added')).toBeGreaterThan(0); // the rack branch
    expect(d.entries.some((e) => e.box[0] > 2384 * 0.75 && e.box[1] > 1684 * 0.8)).toBe(true);
    expect(d.entries.some((e) => e.box[2] < 2384 * 0.75 || e.box[3] < 1684 * 0.8)).toBe(true);
    expect(d.percent).toBeLessThan(2);
  }, 120_000);

  it('pair 19: the addressed beam and the opening changed differently; comments are not content', async () => {
    const [d] = await sheetsOf('19', 1);
    expect(has(d, /^W310x39 → W360x51$/)).toBe(true);
    expect(has(d, /^900x600 → 1200x600$/)).toBe(true);
    // The unrequested hatch in bay 1-2/C-D.
    expect(geometry(d, 'added')).toBeGreaterThan(5);
    // A's review comments and highlights are not drawn into the comparison.
    expect(has(d, /overstressed|confirm secondary|architectural grid/i)).toBe(false);
  }, 120_000);
});
