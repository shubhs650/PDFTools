import { describe, expect, it } from 'vitest';
import {
  MAX_SESSION_FILES,
  comparisonsOf,
  parseSession,
  parseStartup,
  sameSession,
  sessionOf,
  withoutRecoverable,
  type SessionEntry,
} from '../../src/features/session/sessionModel';

// M11-08·O2 (D-53): the record of the files open last time.

const handle = (name: string) => ({ kind: 'file', name }) as unknown as FileSystemFileHandle;

const a = handle('a.pdf');
const b = handle('b.pdf');
const c = handle('c.pdf');

describe('parseStartup', () => {
  it('is the start screen unless "reopen" was stored', () => {
    expect(parseStartup('reopen')).toBe('reopen');
    expect(parseStartup('start')).toBe('start');
    expect(parseStartup(undefined)).toBe('start');
    expect(parseStartup(42)).toBe('start');
  });
});

describe('sessionOf', () => {
  it('keeps the documents with a file handle, in tab order, and the selected one', () => {
    const record = sessionOf(
      [
        { id: 'd1', name: 'a.pdf', source: 'picked', handle: a, fp: 'fa' },
        { id: 'd2', name: 'Untitled 1.pdf', source: 'created', fp: 'fn' }, // never saved
        { id: 'd3', name: 'b.pdf', source: 'dropped', handle: b, fp: 'fb' },
      ],
      'd3',
      [],
      5,
    );
    expect(record).toEqual({
      entries: [
        { name: 'a.pdf', handle: a, fp: 'fa', source: 'picked' },
        { name: 'b.pdf', handle: b, fp: 'fb', source: 'dropped' },
      ],
      active: 1,
      savedAt: 5,
    });
  });

  it('has no selected entry when the selected tab has no file', () => {
    const record = sessionOf(
      [
        { id: 'd1', name: 'a.pdf', handle: a, fp: 'fa' },
        { id: 'd2', name: 'new.pdf' },
      ],
      'd2',
      [],
      0,
    );
    expect(record.active).toBe(-1);
  });

  it('keeps where a file came from only when its hover card can still say so', () => {
    const record = sessionOf(
      [
        { id: 'd1', name: 'a.pdf', source: 'recovered', handle: a, fp: 'fa' },
        { id: 'd2', name: 'b.pdf', source: 'saved', handle: b, fp: 'fb' },
        { id: 'd3', name: 'c.pdf', handle: c, fp: 'fc' },
      ],
      null,
      [],
      0,
    );
    expect(record.entries.map((e) => e.source)).toEqual(['picked', 'saved', 'picked']);
  });

  it('keeps the files still waiting after the open ones, once each', () => {
    const waitingB: SessionEntry = { name: 'b.pdf', handle: b, fp: 'fb', source: 'recent' };
    const waitingA: SessionEntry = { name: 'a.pdf', handle: a, fp: 'fa', source: 'picked' };
    const record = sessionOf(
      [{ id: 'd1', name: 'a.pdf', handle: a, fp: 'fa' }],
      'd1',
      [waitingB, waitingA],
      0,
    );
    expect(record.entries.map((e) => e.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(record.active).toBe(0);
  });

  it('keeps the waiting file that was selected last time selected while none is open', () => {
    const waitingA: SessionEntry = { name: 'a.pdf', handle: a, fp: 'fa', source: 'picked' };
    const waitingB: SessionEntry = { name: 'b.pdf', handle: b, fp: 'fb', source: 'picked' };
    expect(sessionOf([], null, [waitingA, waitingB], 0, waitingB).active).toBe(1);
    // An open file that is selected wins.
    expect(
      sessionOf([{ id: 'd1', name: 'c.pdf', handle: c, fp: 'fc' }], 'd1', [waitingB], 0, waitingB)
        .active,
    ).toBe(0);
  });

  it('keeps at most MAX_SESSION_FILES files', () => {
    const docs = Array.from({ length: MAX_SESSION_FILES + 5 }, (_, i) => ({
      id: `d${String(i)}`,
      name: `${String(i)}.pdf`,
      handle: handle(`${String(i)}.pdf`),
      fp: `f${String(i)}`,
    }));
    const record = sessionOf(docs, `d${String(MAX_SESSION_FILES + 1)}`, [], 0);
    expect(record.entries).toHaveLength(MAX_SESSION_FILES);
    expect(record.active).toBe(-1);
  });
});

describe('sameSession', () => {
  const one = sessionOf([{ id: 'd1', name: 'a.pdf', handle: a, fp: 'fa' }], 'd1', [], 1);

  it('ignores the time and compares files, names, order and the selected tab', () => {
    expect(sameSession(one, { ...one, savedAt: 99 })).toBe(true);
    expect(sameSession(one, { ...one, active: -1 })).toBe(false);
    expect(
      sameSession(
        one,
        sessionOf([{ id: 'd1', name: 'renamed.pdf', handle: a, fp: 'fa' }], 'd1', [], 1),
      ),
    ).toBe(false);
    expect(
      sameSession(one, sessionOf([{ id: 'd1', name: 'a.pdf', handle: b, fp: 'fa' }], 'd1', [], 1)),
    ).toBe(false);
    expect(sameSession(null, null)).toBe(true);
    expect(sameSession(one, null)).toBe(false);
  });
});

describe('parseSession', () => {
  it('reads back what sessionOf wrote', () => {
    const record = sessionOf(
      [
        { id: 'd1', name: 'a.pdf', source: 'launched', handle: a, fp: 'fa' },
        { id: 'd2', name: 'b.pdf', handle: b, fp: 'fb' },
      ],
      'd2',
      [],
      7,
    );
    expect(parseSession(record)).toEqual(record);
  });

  it('drops entries that are not files and an out-of-range selection', () => {
    expect(
      parseSession({
        entries: [
          { name: 'a.pdf', handle: a, fp: 'fa', source: 'picked' },
          { name: 'dir', handle: { kind: 'directory' }, fp: 'fd' },
          { name: 'x.pdf', handle: b }, // no fingerprint
          'junk',
        ],
        active: 3,
        savedAt: 'yesterday',
      }),
    ).toEqual({
      entries: [{ name: 'a.pdf', handle: a, fp: 'fa', source: 'picked' }],
      active: -1,
      savedAt: 0,
    });
    expect(parseSession(undefined)).toBeNull();
    expect(parseSession({ entries: 'no' })).toBeNull();
  });
});

describe('withoutRecoverable', () => {
  it('leaves out files with a recovery snapshot and follows the selected one', () => {
    const record = sessionOf(
      [
        { id: 'd1', name: 'a.pdf', handle: a, fp: 'fa' },
        { id: 'd2', name: 'b.pdf', handle: b, fp: 'fb' },
        { id: 'd3', name: 'c.pdf', handle: c, fp: 'fc' },
      ],
      'd3',
      [],
      0,
    );
    const rest = withoutRecoverable(record, new Set(['fb']));
    expect(rest.entries.map((e) => e.name)).toEqual(['a.pdf', 'c.pdf']);
    expect(rest.active).toBe(1);
    expect(withoutRecoverable(record, new Set(['fc'])).active).toBe(-1);
  });
});

describe('comparisons in the record (M12-08, D-58)', () => {
  const h = (name: string) => ({ kind: 'file', name }) as unknown as FileSystemFileHandle;
  const doc = (name: string, range = '', onDisk = true) => ({
    id: name,
    name,
    source: 'dropped' as const,
    ...(onDisk ? { handle: h(name), fp: `fp-${name}` } : {}),
    range,
  });

  it('keeps the files that can be reopened, and drops a comparison with none', () => {
    const { comparisons, activeComparison } = comparisonsOf([
      {
        type: 'overlay',
        index: 2,
        a: [doc('a.pdf', '1-2')],
        b: [doc('new.pdf', '', false)],
        active: false,
      },
      { type: 'text', index: 3, a: [doc('x.pdf', '', false)], b: [], active: true },
      { type: 'text', index: 4, a: [doc('c.pdf')], b: [doc('d.pdf')], active: true },
    ]);
    expect(comparisons).toHaveLength(2);
    expect(comparisons[0]).toMatchObject({
      type: 'overlay',
      index: 2,
      a: [{ name: 'a.pdf', range: '1-2' }],
      b: [],
    });
    expect(activeComparison).toBe(1);
  });

  it('reads back what it wrote, and notices a changed range', () => {
    const { comparisons, activeComparison } = comparisonsOf([
      { type: 'text', index: 0, a: [doc('a.pdf', '3')], b: [doc('b.pdf')], active: true },
    ]);
    const record = { entries: [], active: -1, comparisons, activeComparison, savedAt: 5 };
    const back = parseSession(JSON.parse(JSON.stringify(record)));
    expect(back?.comparisons?.[0]).toMatchObject({ type: 'text', index: 0, a: [{ range: '3' }] });
    expect(back?.activeComparison).toBe(0);
    expect(sameSession(record, { ...record, savedAt: 9 })).toBe(true);
    const changed = {
      ...record,
      comparisons: comparisons.map((c) => ({ ...c, a: c.a.map((f) => ({ ...f, range: '4' })) })),
    };
    expect(sameSession(record, changed)).toBe(false);
  });

  it('ignores what is not a comparison, and keeps one file per side of a text comparison', () => {
    const file = { name: 'a.pdf', handle: { kind: 'file' }, fp: 'f', source: 'picked', range: '' };
    const back = parseSession({
      entries: [],
      active: -1,
      comparisons: [
        { type: 'nope', a: [file] },
        { type: 'text', index: -3, a: [file, file], b: 'x' },
      ],
      activeComparison: 7,
    });
    expect(back?.comparisons).toEqual([
      { type: 'text', index: 0, a: [{ ...file, source: 'picked' }], b: [] },
    ]);
    expect(back?.activeComparison).toBe(-1);
  });

  it('leaves out a comparison file that has a recovery snapshot', () => {
    const { comparisons } = comparisonsOf([
      { type: 'overlay', index: 0, a: [doc('a.pdf')], b: [doc('b.pdf')], active: false },
    ]);
    const rest = withoutRecoverable(
      { entries: [], active: -1, comparisons, savedAt: 0 },
      new Set(['fp-b.pdf']),
    );
    expect(rest.comparisons?.[0]?.b).toEqual([]);
  });
});
