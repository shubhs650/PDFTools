// Spike S31 (M12-06): the pure parts of the comparison file — the word
// difference stand-in, the data checks, and a round trip through our object
// layer on a self-made one-page PDF (no PDFium: the reader and the save core).
import { describe, expect, it } from 'vitest';
import { isPrefix } from '../../src/workers/render/save/bytes';
import { buildPdf } from '../shared/mini-pdf';
import {
  FORMAT,
  KEY_DATA,
  decodeData,
  encodeData,
  keyOf,
  revisionCount,
  sha256Hex,
  type ComparisonData,
} from './format';
import { myers } from './marks';
import { detect, openComparison } from './read';
import { Section } from './section';

const page = (): Uint8Array =>
  buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    { dict: '<< >>', stream: '0 0 1 rg 10 10 50 50 re f' },
  ]);

const WHEN = new Date(Date.UTC(2026, 10, 22, 12));

async function textFile(B: Uint8Array, A: Uint8Array, userFile?: Uint8Array) {
  const sec = await Section.open(B);
  const files = [];
  if (userFile) {
    // A file the document already had: it must stay, and stay findable.
    const ref = sec.embed({
      key: 'zz-user',
      fileName: 'notes.txt',
      bytes: userFile,
      mime: 'text/plain',
      desc: 'the user’s own',
      relationship: 'Supplement',
      modified: WHEN,
    });
    files.push({ key: 'zz-user', ref });
  }
  const data: ComparisonData = {
    format: FORMAT,
    version: 1,
    kind: 'text',
    created: WHEN.toISOString(),
    modified: WHEN.toISOString(),
    app: 'test',
    documents: {
      A: [
        {
          name: 'a.pdf',
          size: A.length,
          sha256: await sha256Hex(A),
          pages: 1,
          storage: { attachment: keyOf('A', 0, 1) },
        },
      ],
      B: [
        {
          name: 'b.pdf',
          size: B.length,
          sha256: await sha256Hex(B),
          pages: 1,
          storage: { prefix: { length: B.length, revisions: revisionCount(B) } },
        },
      ],
    },
    options: {},
    ignoreZones: [],
    checked: [],
    closeOut: [],
  };
  const a = sec.embed({
    key: keyOf('A', 0, 1),
    fileName: 'a.pdf',
    bytes: A,
    mime: 'application/pdf',
    desc: 'A',
    relationship: 'Source',
    modified: WHEN,
  });
  const d = sec.embed({
    key: KEY_DATA,
    fileName: 'comparison.json',
    bytes: encodeData(data),
    mime: 'application/json',
    desc: 'data',
    relationship: 'Data',
    modified: WHEN,
  });
  await sec.tagCatalog({
    files: [...files, { key: keyOf('A', 0, 1), ref: a }, { key: KEY_DATA, ref: d }],
    kind: 'text',
    version: 1,
    data: d,
    modified: WHEN,
  });
  return sec.finish();
}

describe('S31 comparison file', () => {
  it('Myers finds inserted, deleted and replaced runs', () => {
    const ops = myers('a b c d e'.split(' '), 'a x c d e f'.split(' ')).filter((o) => !o.eq);
    expect(ops).toEqual([
      { eq: false, a0: 1, a1: 2, b0: 1, b1: 2 },
      { eq: false, a0: 5, a1: 5, b0: 5, b1: 6 },
    ]);
    expect(myers([], ['a'])).toEqual([{ eq: false, a0: 0, a1: 0, b0: 0, b1: 1 }]);
    expect(myers(['a'], ['a'])).toEqual([{ eq: true, a0: 0, a1: 1, b0: 0, b1: 1 }]);
  });

  it('checks the data: format, newer versions, where B may live', () => {
    expect(() => decodeData(new TextEncoder().encode('{"format":"other"}'))).toThrow(
      /not a comparison/,
    );
    expect(() =>
      decodeData(
        new TextEncoder().encode('{"format":"triya-comparison","version":2,"kind":"text"}'),
      ),
    ).toThrow(/newer/);
    const f = { sha256: '0'.repeat(64), storage: { prefix: { length: 1, revisions: 1 } } };
    const bad = { format: FORMAT, version: 1, kind: 'overlay', documents: { A: [f], B: [f] } };
    expect(() => decodeData(new TextEncoder().encode(JSON.stringify(bad)))).toThrow(
      /only Document B/,
    );
  });

  it('keeps B as the exact prefix and recovers both documents', async () => {
    const B = page();
    const A = new TextEncoder().encode('%PDF-1.7 old revision bytes');
    const user = new TextEncoder().encode('kept');
    const out = await textFile(B, A, user);
    expect(isPrefix(B, out)).toBe(true);
    const d = await detect(out);
    expect(d?.kind).toBe('text');
    expect(d?.via).toBe('pieceInfo');
    const o = await openComparison(out);
    expect(o.B[0]?.exact).toBe(true);
    expect(o.A[0]?.exact).toBe(true);
    expect(o.A[0]?.bytes).toEqual(A);
    expect(o.foreignRevisions).toBe(0);
    // The name tree is one sorted leaf with the user's own file kept.
    const sec = await Section.open(out);
    const cat = await sec.catalog();
    const names = await sec.reader.resolve(cat.dict.get('Names'));
    const tree = await sec.nameTree(names instanceof Map ? names.get('EmbeddedFiles') : undefined);
    const keys = tree.map(([k]) => k.text());
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('zz-user');
  });

  it('notices sections appended by another program, and works without /PieceInfo', async () => {
    const out = await textFile(page(), new TextEncoder().encode('A'));
    const sec = await Section.open(out);
    const cat = await sec.catalog();
    const d = new Map(cat.dict);
    d.delete('PieceInfo');
    sec.value(cat.num, d);
    const later = sec.finish();
    const o = await openComparison(later);
    expect(o.detected.via).toBe('attachment');
    expect(o.B[0]?.exact).toBe(true);
    expect(o.foreignRevisions).toBe(1);
  });

  it('does not mistake a plain PDF for a comparison file', async () => {
    expect(await detect(page())).toBeNull();
  });
});
