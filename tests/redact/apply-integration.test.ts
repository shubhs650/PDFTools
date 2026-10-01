// M4-17/18 (§7.9 steps 2–5, ADR-017) on real PDFium: apply → re-cut crossing
// paths → remove annotations → rewrite → sanitize → rewrite → verify, over the
// self-made adversarial file (e2e/fixtures/redaction.ts). Every page passes
// except the crossing line inside a Form XObject (page 9), which the
// verification must report. No secret and no hidden data remain anywhere in
// the decoded file; kept text survives; one revision; encryption kept.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasQpdf, OWNER_PW, qpdfEncrypt, USER_PW } from '../../e2e/fixtures/encrypted';
import {
  adversarialPdf,
  HIDDEN,
  KEPT,
  markedBulkPdf,
  REPEATED,
  SECRETS,
} from '../../e2e/fixtures/redaction';
import { isDict, PdfStream, PdfString, type PdfValue } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import {
  applyRedactions,
  redactAreas,
  type RedactOutcome,
} from '../../src/workers/work/redact/apply';
import type { JobSlice } from '../../src/workers/work/scheduler';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { Verifier, type Leak } from '../../src/workers/work/redact/verify';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const slice: JobSlice = {
  checkpoint: () => Promise.resolve(),
  signal: new AbortController().signal,
};
const none = () => undefined;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

/** Canaries in every decoded stream and string of the file. */
async function canaries(bytes: Uint8Array, words: readonly string[], password?: string) {
  const r = await PdfReader.open(bytes, undefined, password ? { password } : {});
  const found = new Set<string>();
  const dec = new TextDecoder('latin1');
  const scan = (s: string) => {
    for (const c of words) if (s.includes(c)) found.add(c);
  };
  const walk = async (v: PdfValue, depth: number): Promise<void> => {
    if (depth > 30) return;
    if (v instanceof PdfString) scan(dec.decode(v.bytes));
    else if (Array.isArray(v)) for (const x of v) await walk(x, depth + 1);
    else if (isDict(v)) for (const x of v.values()) await walk(x, depth + 1);
    else if (v instanceof PdfStream) {
      await walk(v.dict, depth + 1);
      try {
        scan(dec.decode(await r.decode(v)));
      } catch {
        scan(dec.decode(v.raw));
      }
    }
  };
  for (const num of r.xref.keys()) {
    try {
      await walk(await r.get(num), 0);
    } catch {
      // unreadable: not a leak by itself
    }
  }
  return [...found];
}

async function text(bytes: Uint8Array, password?: string): Promise<string> {
  const doc = await native
    .openDocumentBuffer(
      { id: `t${String(Math.random())}`, content: bytes.slice().buffer },
      password ? { password } : {},
    )
    .toPromise();
  try {
    return new Verifier(mod).documentText(docPtrOf(native, doc.id));
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

function qpdfOk(bytes: Uint8Array, password?: string): boolean {
  if (!hasQpdf()) return true;
  const dir = mkdtempSync(join(tmpdir(), 'redact-'));
  writeFileSync(join(dir, 'f.pdf'), bytes);
  return (
    spawnSync('qpdf', [
      '--check',
      ...(password ? [`--password=${password}`] : []),
      join(dir, 'f.pdf'),
    ]).status === 0
  );
}

describe('negative controls: the verifier on the unredacted source flags every page', () => {
  it('each page with content in its area is reported, with the right kind', async () => {
    const src = adversarialPdf();
    const doc = await native
      .openDocumentBuffer({ id: 'neg', content: src.slice().buffer })
      .toPromise();
    try {
      const d = docPtrOf(native, doc.id);
      const areas = redactAreas(mod, d);
      const v = new Verifier(mod);
      const leaks: Leak[] = [];
      for (const [i, rs] of areas) {
        const page = rawCall(mod, 'FPDF_LoadPage', d, i);
        v.textInRects(i, page, rs, leaks);
        v.objectsInRects(i, page, rs, leaks);
        v.annotsInRects(i, page, rs, leaks);
        rawCall(mod, 'FPDF_ClosePage', page);
      }
      const pages = new Set(leaks.map((l) => l.page));
      expect([...pages].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      const kinds = (page: number) => leaks.filter((l) => l.page === page).map((l) => l.kind);
      expect(kinds(0)).toContain('text');
      expect(kinds(1)).toContain('image');
      expect(kinds(3)).toContain('path');
      expect(kinds(6)).toContain('annotation');
      expect(kinds(8)).toContain('path');
    } finally {
      await native.closeDocument(doc).toPromise();
    }
  });
});

describe('apply redactions on the adversarial file', () => {
  let out: RedactOutcome;
  beforeAll(async () => {
    out = await applyRedactions(mod, native, adversarialPdf(), undefined, slice, none);
  });

  it('applies every mark; only the crossing line inside a Form XObject (page 9) is reported', () => {
    expect(out.marks).toBe(9);
    expect(out.pages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.leaks).toEqual([{ page: 8, kind: 'path' }]);
    expect(out.recut.replaced).toBeGreaterThanOrEqual(2);
    expect(out.removedAnnotations).toBeGreaterThanOrEqual(3);
    expect(out.searched).toBeGreaterThan(0);
  });

  it('no secret or hidden data anywhere in the decoded file; kept text survives', async () => {
    const found = await canaries(out.bytes, [...SECRETS, ...HIDDEN]);
    // FORMDELTA is the form XObject's own text, removed by the engine; nothing else remains.
    expect(found).toEqual([]);
    const t = await text(out.bytes);
    for (const k of [...KEPT.filter((k) => k !== 'SAFEOUTLINE'), REPEATED]) expect(t).toContain(k);
    expect(out.sanitize.outlineItemsRemoved).toBe(1);
    expect(out.sanitize.fieldsRemoved).toBe(1);
  });

  it('one revision, qpdf-clean', () => {
    expect((new TextDecoder('latin1').decode(out.bytes).match(/startxref/g) ?? []).length).toBe(1);
    expect(qpdfOk(out.bytes)).toBe(true);
  });

  it('a skipped step makes the verification fail (the e2e failure path)', async () => {
    const r = await applyRedactions(
      mod,
      native,
      adversarialPdf(),
      undefined,
      slice,
      none,
      'annotations',
    );
    expect(r.leaks.some((l) => l.kind === 'annotation')).toBe(true);
    const s = await applyRedactions(
      mod,
      native,
      adversarialPdf(),
      undefined,
      slice,
      none,
      'sanitize',
    );
    expect(s.leaks.some((l) => l.kind === 'structure')).toBe(true);
    const c = await applyRedactions(mod, native, adversarialPdf(), undefined, slice, none, 'recut');
    expect(c.leaks.some((l) => l.page === 3 && l.kind === 'path')).toBe(true);
  });
});

describe('encrypted and bulk sources', () => {
  it.skipIf(!hasQpdf())(
    'AES-256: same result, the output stays encrypted and opens with the user password',
    async () => {
      const enc = qpdfEncrypt(adversarialPdf(), USER_PW, OWNER_PW, ['256']);
      const r = await applyRedactions(mod, native, enc, OWNER_PW, slice, none);
      expect(r.leaks).toEqual([{ page: 8, kind: 'path' }]);
      const reader = await PdfReader.open(r.bytes, undefined, { password: USER_PW });
      expect(reader.encrypted).toBe(true);
      expect(qpdfOk(r.bytes, USER_PW)).toBe(true);
    },
  );

  it('200 pages × 3 marks: all applied and verified, progress per page', async () => {
    const steps: number[] = [];
    const r = await applyRedactions(mod, native, markedBulkPdf(200, 3), undefined, slice, (p) => {
      steps.push(p.done);
    });
    expect(r.marks).toBe(600);
    expect(r.leaks).toEqual([]);
    expect(steps.at(-1)).toBe(400);
  });
});
