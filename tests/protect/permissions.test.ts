import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  OWNER_PW,
  USER_PW,
  encryptedVariants,
  hasQpdf,
  type EncryptedVariant,
} from '../../e2e/fixtures/encrypted';
import { fullFormPdf } from '../../e2e/fixtures/generate';
import {
  CAPABILITIES,
  PERM_ANNOTATE,
  PERM_COPY,
  PERM_FILL_FORMS,
  PERM_MODIFY,
  PERM_PRINT,
  PERM_PRINT_HIGH,
  UNRESTRICTED,
  allows,
  restrictions,
} from '../../src/model/permissions';
import { SaveTracker } from '../../src/workers/render/save/tracker';

// Permission rules (D-19, §7.12, rule 9, ADR-013 decision 2).

describe('allows / restrictions', () => {
  it('an unencrypted file allows everything, whatever its bits say', () => {
    expect(restrictions(UNRESTRICTED)).toEqual([]);
    expect(restrictions({ permissions: 0, revision: -1 })).toEqual([]);
  });

  it('revision 3+: one bit per capability', () => {
    // qpdf R3/R4/R6 with print, modify, copy, annotate and fill denied: P = -3392.
    const denied = { permissions: 0xfffff2c0, revision: 6 };
    expect(restrictions(denied)).toEqual([
      'print',
      'printHighQuality',
      'copy',
      'annotate',
      'fillForms',
      'modify',
      'assemble',
    ]);
    // Accessibility (bit 10) is still allowed in that file.
    expect(allows(denied, 'accessibility')).toBe(true);
  });

  it('revision 3+: annotate also allows filling in forms; modify also allows assembling', () => {
    const p = PERM_ANNOTATE | PERM_MODIFY;
    expect(allows({ permissions: p, revision: 4 }, 'fillForms')).toBe(true);
    expect(allows({ permissions: p, revision: 4 }, 'assemble')).toBe(true);
    expect(allows({ permissions: PERM_FILL_FORMS, revision: 4 }, 'annotate')).toBe(false);
    expect(allows({ permissions: PERM_FILL_FORMS, revision: 4 }, 'fillForms')).toBe(true);
  });

  it('revision 3+: high-quality printing needs both print bits', () => {
    expect(allows({ permissions: PERM_PRINT, revision: 3 }, 'printHighQuality')).toBe(false);
    expect(allows({ permissions: PERM_PRINT_HIGH, revision: 3 }, 'printHighQuality')).toBe(false);
    expect(
      allows({ permissions: PERM_PRINT | PERM_PRINT_HIGH, revision: 3 }, 'printHighQuality'),
    ).toBe(true);
  });

  it('revision 2: bits 9–12 do not exist; they follow bits 6, 5, 4 and 3', () => {
    // qpdf's R2 file with everything denied: P = -64. Bits 9–12 are set only
    // because undefined bits are 1 (ADR-013 finding 2).
    const r2 = { permissions: 0xffffffc0, revision: 2 };
    expect(restrictions(r2)).toEqual(CAPABILITIES);
    const all = PERM_PRINT | PERM_MODIFY | PERM_COPY | PERM_ANNOTATE;
    expect(restrictions({ permissions: all, revision: 2 })).toEqual([]);
  });

  it('after an owner unlock (all bits set) nothing is restricted', () => {
    expect(restrictions({ permissions: 0xfffffffc, revision: 6 })).toEqual([]);
  });
});

// Real PDFium on qpdf-encrypted files: the Render worker's tracker refuses
// what the flags deny, and an owner unlock lifts it (rule 9).
const qpdf = hasQpdf();
if (!qpdf && process.env.CI) throw new Error('qpdf is required in CI (apt-get install qpdf)');

describe.skipIf(!qpdf)('Render-worker permission checks (real PDFium, qpdf fixtures)', () => {
  const require = createRequire(import.meta.url);
  let mod: WrappedPdfiumModule;
  let native: PdfiumNative;
  let tracker: SaveTracker;
  let variants: EncryptedVariant[];
  let seq = 0;

  beforeAll(async () => {
    mod = await init({
      wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
    });
    native = new PdfiumNative(mod, { fontFallback: null });
    tracker = new SaveTracker(mod, native);
    variants = encryptedVariants(fullFormPdf());
  });

  async function open(v: EncryptedVariant, password: string): Promise<PdfDocumentObject> {
    const id = `p${String(++seq)}`;
    const doc = await native
      .openDocumentBuffer({ id, content: v.bytes.slice().buffer }, { password })
      .toPromise();
    tracker.opened(id, v.bytes);
    return doc;
  }
  const allowed = (method: string, id: string): boolean => {
    try {
      tracker.checkAllowed(method, id);
      return true;
    } catch {
      return false;
    }
  };

  it.each(['R2-rc4-40', 'R3-rc4-128', 'R4-aes-128', 'R6-aes-256'])(
    '%s: form filling and annotating are refused until the owner unlocks',
    async (name) => {
      const v = variants.find((x) => x.name === name);
      if (!v) throw new Error(name);
      const doc = await open(v, USER_PW);
      expect(allowed('setFormFieldValue', doc.id)).toBe(false);
      expect(allowed('createPageAnnotation', doc.id)).toBe(false);
      expect(await native.unlockOwnerPermissions(doc, 'wrong').toPromise()).toBe(false);
      expect(allowed('setFormFieldValue', doc.id)).toBe(false);
      expect(await native.unlockOwnerPermissions(doc, OWNER_PW).toPromise()).toBe(true);
      expect(allowed('setFormFieldValue', doc.id)).toBe(true);
      expect(allowed('createPageAnnotation', doc.id)).toBe(true);
      tracker.closed(doc.id);
      await native.closeDocument(doc).toPromise();
    },
  );

  it('no password and a wrong password fail with the same PDFium code (4)', async () => {
    const v = variants.find((x) => x.name === 'R6-aes-256');
    if (!v) throw new Error('R6');
    const code = async (password?: string) =>
      native
        .openDocumentBuffer(
          { id: `c${String(++seq)}`, content: v.bytes.slice().buffer },
          password === undefined ? {} : { password },
        )
        .toPromise()
        .then(
          () => 0,
          (e: unknown) => (e as { reason?: { code?: number } }).reason?.code,
        );
    expect(await code()).toBe(4);
    expect(await code('nope')).toBe(4);
  });
});
