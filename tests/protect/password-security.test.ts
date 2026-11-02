// M6-12 (D-40 a, §7.12, ADR-022 decision 2) on real PDFium: the Render
// worker's copy route (secureCopy, driven through the SaveTracker as the
// worker drives it) and the Work worker's check (verifySecured). The output
// opens with each password and refuses without; permissions are as asked;
// our object layer's keys survive under the new key; the open document, its
// pending Ctrl+S and its security are untouched; owner rights are required;
// a wrong expectation fails the check. Self-made files only (rule 13).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { type PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, USER_PW, encryptedVariants, hasQpdf } from '../../e2e/fixtures/encrypted';
import { annotatedPdf, fullFormPdf, simplePdf } from '../../e2e/fixtures/generate';
import { RpcError } from '../../src/engine/errors';
import {
  ALL_ALLOWED,
  encryptPlan,
  type PasswordSecurityForm,
} from '../../src/model/passwordSecurity';
import { allows, CAPABILITIES, type Capability } from '../../src/model/permissions';
import { D, N, S, isDict, type PdfValue } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { secureCopy, type SecureAction } from '../../src/workers/render/security';
import { verifySecured, type SecurityCheck } from '../../src/workers/work/verifySecurity';

const require = createRequire(import.meta.url);
const qpdf = hasQpdf();
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-security-'));
const inflate = (b: Uint8Array) => Promise.resolve(new Uint8Array(inflateSync(b)));
const slice = { signal: new AbortController().signal, checkpoint: () => Promise.resolve() };

let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
});

async function open(bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> {
  const id = `s${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  tracker.opened(id, bytes, password);
  await tracker.securityReady(id);
  return doc;
}

async function close(doc: PdfDocumentObject): Promise<void> {
  tracker.closed(doc.id);
  await native.closeDocument(doc).toPromise();
}

/** What a reader sees: refused (PDFium error code), or the rights it gets. */
async function opens(bytes: Uint8Array, password?: string) {
  const id = `o${String(++seq)}`;
  try {
    const doc = await native
      .openDocumentBuffer(
        { id, content: bytes.slice().buffer },
        password === undefined ? {} : { password },
      )
      .toPromise();
    const ptr = docPtrOf(native, id);
    const sec = {
      permissions: rawCall(mod, 'FPDF_GetDocPermissions', ptr) >>> 0,
      revision: rawCall(mod, 'FPDF_GetSecurityHandlerRevision', ptr),
    };
    const out = {
      opened: true as const,
      revision: sec.revision,
      owner: Boolean(rawCall(mod, 'EPDF_IsOwnerUnlocked', ptr)),
      allowed: CAPABILITIES.filter((c) => allows(sec, c)),
    };
    await native.closeDocument(doc).toPromise();
    return out;
  } catch (err) {
    const e = err as { reason?: { code?: unknown } };
    return { opened: false as const, code: e.reason?.code };
  }
}

function qpdfOk(bytes: Uint8Array, password?: string): boolean {
  if (!qpdf) return true;
  const file = join(tmp, `q${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  const pw = password === undefined ? [] : [`--password=${password}`];
  return [0, 3].includes(spawnSync('qpdf', [...pw, '--check', file]).status ?? -1);
}

const form = (patch: Partial<PasswordSecurityForm>): PasswordSecurityForm => ({
  openRequired: false,
  openPassword: '',
  openConfirm: '',
  restrict: false,
  permissionsPassword: '',
  permissionsConfirm: '',
  allowed: ALL_ALLOWED,
  ...patch,
});

function encryptOf(f: PasswordSecurityForm): { action: SecureAction; check: SecurityCheck } {
  const p = encryptPlan(f);
  return {
    action: {
      kind: 'encrypt',
      userPassword: p.userPassword,
      ownerPassword: p.ownerPassword,
      flags: p.flags,
    },
    check: {
      kind: 'encrypt',
      userPassword: p.userPassword,
      ownerPassword: p.ownerPassword,
      allowed: p.allowed,
    },
  };
}

async function secure(doc: PdfDocumentObject, action: SecureAction) {
  const steps: number[] = [];
  const r = await secureCopy(mod, native, tracker, doc.id, action, slice.signal, (s) =>
    steps.push(s),
  );
  return { ...r, steps };
}

const verify = (
  bytes: Uint8Array,
  check: SecurityCheck,
  expected: Parameters<typeof verifySecured>[4],
) => verifySecured(mod, native, bytes.slice().buffer, check, expected, slice, () => undefined);

const measure = (): PdfValue => D({ Type: N('Measure'), Subtype: N('RL'), R: S('1 mm = 100 mm') });

/** The /Measure /R string of the first annotation that has one (our reader). */
async function measureR(bytes: Uint8Array, password?: string): Promise<string | null> {
  const r = await PdfReader.open(bytes, inflate, password === undefined ? {} : { password });
  for (const page of await r.pages()) {
    const annots = await r.resolve(page.dict.get('Annots'));
    for (const ref of Array.isArray(annots) ? annots : []) {
      const a = await r.resolve(ref);
      const m = isDict(a) ? await r.resolve(a.get('Measure')) : undefined;
      if (isDict(m)) return (m.get('R') as { text(): string }).text();
    }
  }
  return null;
}

const firstAnnotId = async (doc: PdfDocumentObject): Promise<{ page: number; id: string }> => {
  for (const page of doc.pages) {
    const annots = (await native.getPageAnnotations(doc, page).toPromise()) as { id: string }[];
    const first = annots[0];
    if (first) return { page: page.index, id: first.id };
  }
  throw new Error('no annotation');
};

const RESTRICTED: Capability[] = ['print', 'accessibility', 'annotate'];

describe('Password Security: the copy route (secureCopy + verifySecured)', () => {
  it('open + permissions passwords: refused without, restricted with the open one, full with the other', async () => {
    const src = annotatedPdf();
    const doc = await open(src);
    // Our object layer's key, staged and unsaved: it must reach the new file intact.
    const a = await firstAnnotId(doc);
    tracker.stagePatch(doc.id, { page: a.page, annot: a.id }, new Map([['Measure', measure()]]));
    const { action, check } = encryptOf(
      form({
        openRequired: true,
        openPassword: USER_PW,
        openConfirm: USER_PW,
        restrict: true,
        permissionsPassword: OWNER_PW,
        permissionsConfirm: OWNER_PW,
        allowed: new Set(RESTRICTED),
      }),
    );
    const before = tracker.dirtyState(doc.id);
    const r = await secure(doc, action);
    expect(r.steps).toEqual([1, 2]);
    expect(await verify(r.bytes, check, r.expected)).toEqual({ ok: true });

    expect(await opens(r.bytes)).toMatchObject({ opened: false, code: 4 });
    expect(await opens(r.bytes, 'wrong')).toMatchObject({ opened: false, code: 4 });
    const user = await opens(r.bytes, USER_PW);
    expect(user).toMatchObject({ opened: true, revision: 6, owner: false });
    // annotate also allows filling in forms (bit 6).
    expect(user.opened && user.allowed).toEqual([
      'print',
      'accessibility',
      'annotate',
      'fillForms',
    ]);
    expect(await opens(r.bytes, OWNER_PW)).toMatchObject({
      opened: true,
      owner: true,
      allowed: [...CAPABILITIES],
    });
    expect(await measureR(r.bytes, OWNER_PW)).toBe('1 mm = 100 mm');
    expect(await measureR(r.bytes, USER_PW)).toBe('1 mm = 100 mm');
    expect(qpdfOk(r.bytes, USER_PW)).toBe(true);
    expect(qpdfOk(r.bytes, OWNER_PW)).toBe(true);

    // The open document is untouched: still plain, same pending changes, and
    // its Ctrl+S still writes them (unencrypted, as the file is).
    const ptr = docPtrOf(native, doc.id);
    expect(rawCall(mod, 'FPDF_GetSecurityHandlerRevision', ptr)).toBe(-1);
    expect(tracker.dirtyState(doc.id)).toEqual(before);
    const save = tracker.saveIncremental(doc.id);
    const saved = concatBytes([src, save.tail]);
    expect(await opens(saved)).toMatchObject({ opened: true, revision: -1 });
    expect(await measureR(saved)).toBe('1 mm = 100 mm');
    await close(doc);
  });

  it('a pending Ctrl+S survives: secureCopy never replaces it', async () => {
    const src = simplePdf(2);
    const doc = await open(src);
    tracker.stagePatch(doc.id, { page: 0 }, new Map([['VP', [D({ Type: N('Viewport') })]]]));
    const pending = tracker.saveIncremental(doc.id);
    const { action } = encryptOf(form({ openRequired: true, openPassword: 'a', openConfirm: 'a' }));
    await secure(doc, action);
    expect(() => tracker.commit(doc.id, pending.tail.length)).not.toThrow();
    await close(doc);
  });

  it('open password only: the same password gives owner rights and nothing is restricted', async () => {
    const doc = await open(fullFormPdf());
    const { action, check } = encryptOf(
      form({ openRequired: true, openPassword: 'pässwörd パス', openConfirm: 'pässwörd パス' }),
    );
    const r = await secure(doc, action);
    expect(await verify(r.bytes, check, r.expected)).toEqual({ ok: true });
    expect(await opens(r.bytes)).toMatchObject({ opened: false });
    expect(await opens(r.bytes, 'pässwörd パス')).toMatchObject({
      opened: true,
      owner: true,
      allowed: [...CAPABILITIES],
    });
    expect(qpdfOk(r.bytes, 'pässwörd パス')).toBe(true);
    await close(doc);
  });

  it('permissions password only: opens without a password, restricted as asked', async () => {
    const doc = await open(simplePdf(3));
    const { action, check } = encryptOf(
      form({
        restrict: true,
        permissionsPassword: OWNER_PW,
        permissionsConfirm: OWNER_PW,
        allowed: new Set<Capability>(['print', 'printHighQuality', 'modify']),
      }),
    );
    const r = await secure(doc, action);
    expect(await verify(r.bytes, check, r.expected)).toEqual({ ok: true });
    const none = await opens(r.bytes);
    expect(none).toMatchObject({ opened: true, revision: 6, owner: false });
    // modify also allows assembly (bit 4).
    expect(none.opened && none.allowed).toEqual([
      'print',
      'printHighQuality',
      'modify',
      'assemble',
    ]);
    expect(await opens(r.bytes, OWNER_PW)).toMatchObject({ owner: true });
    expect(qpdfOk(r.bytes)).toBe(true);
    await close(doc);
  });

  it.skipIf(!qpdf)('Remove Security needs owner rights; with them the copy is plain', async () => {
    const v = encryptedVariants(annotatedPdf()).find((x) => x.name === 'R6-aes-256');
    if (!v) throw new Error('fixture');
    // Opened with the user password only: refused (PDFium would remove it anyway).
    const restricted = await open(v.bytes, USER_PW);
    const refused = await secure(restricted, { kind: 'remove' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RpcError);
    expect((refused as RpcError).code).toBe('pdfium:5');
    // Changing passwords is refused the same way.
    const change = encryptOf(form({ openRequired: true, openPassword: 'x', openConfirm: 'x' }));
    expect(
      await secure(restricted, change.action).catch((e: unknown) => (e as RpcError).code),
    ).toBe('pdfium:5');
    // After an owner unlock (the app's Unlock flow), it is allowed.
    expect(await native.unlockOwnerPermissions(restricted, OWNER_PW).toPromise()).toBe(true);
    tracker.ownerUnlocked(restricted.id, OWNER_PW);
    const r = await secure(restricted, { kind: 'remove' });
    expect(await verify(r.bytes, { kind: 'remove' }, r.expected)).toEqual({ ok: true });
    expect(await opens(r.bytes)).toMatchObject({
      opened: true,
      revision: -1,
      allowed: [...CAPABILITIES],
    });
    expect(qpdfOk(r.bytes)).toBe(true);
    // The open document is still encrypted.
    expect(rawCall(mod, 'FPDF_GetSecurityHandlerRevision', docPtrOf(native, restricted.id))).toBe(
      6,
    );
    await close(restricted);

    // Opened with the owner password: allowed at once.
    const owner = await open(v.bytes, OWNER_PW);
    const r2 = await secure(owner, { kind: 'remove' });
    expect(await verify(r2.bytes, { kind: 'remove' }, r2.expected)).toEqual({ ok: true });
    await close(owner);
  });

  it.skipIf(!qpdf)('changing passwords (owner): only the new ones open the file', async () => {
    const v = encryptedVariants(simplePdf(2)).find((x) => x.name === 'R6-aes-256');
    if (!v) throw new Error('fixture');
    const doc = await open(v.bytes, OWNER_PW);
    const { action, check } = encryptOf(
      form({
        openRequired: true,
        openPassword: 'new-open',
        openConfirm: 'new-open',
        restrict: true,
        permissionsPassword: 'new-owner',
        permissionsConfirm: 'new-owner',
        allowed: new Set<Capability>(['print']),
      }),
    );
    const r = await secure(doc, action);
    expect(await verify(r.bytes, check, r.expected)).toEqual({ ok: true });
    expect(await opens(r.bytes, USER_PW)).toMatchObject({ opened: false });
    expect(await opens(r.bytes, OWNER_PW)).toMatchObject({ opened: false });
    expect(await opens(r.bytes, 'new-open')).toMatchObject({ opened: true, owner: false });
    expect(await opens(r.bytes, 'new-owner')).toMatchObject({ opened: true, owner: true });
    await close(doc);
  });

  it('Remove Security on a plain document is refused', async () => {
    const doc = await open(simplePdf(1));
    expect(await secure(doc, { kind: 'remove' }).catch((e: unknown) => (e as RpcError).code)).toBe(
      'security-none',
    );
    await close(doc);
  });

  it('the check fails when the file is not what was asked for', async () => {
    const doc = await open(annotatedPdf());
    const { action, check } = encryptOf(
      form({
        restrict: true,
        permissionsPassword: OWNER_PW,
        permissionsConfirm: OWNER_PW,
        allowed: new Set<Capability>(['print']),
      }),
    );
    const r = await secure(doc, action);
    // Other permissions than asked.
    expect(
      await verify(r.bytes, { ...check, allowed: ['print', 'copy'] } as SecurityCheck, r.expected),
    ).toMatchObject({
      ok: false,
      reason: 'permissions',
    });
    // An open password was asked for, but the file opens without one.
    expect(
      await verify(r.bytes, { ...check, userPassword: 'x' } as SecurityCheck, r.expected),
    ).toMatchObject({
      ok: false,
      reason: 'opens-without-password',
    });
    // A wrong permissions password.
    expect(
      await verify(r.bytes, { ...check, ownerPassword: 'nope' } as SecurityCheck, r.expected),
    ).toMatchObject({
      ok: false,
      reason: 'owner-password',
    });
    // A lost comment (the expectation has one more).
    const page = r.expected.pages.find((p) => p.annots.length > 0);
    const extra = page?.annots[0];
    if (!page || !extra) throw new Error('no annotated page');
    const more = {
      ...r.expected,
      pages: r.expected.pages.map((p) =>
        p === page ? { ...p, annots: [...p.annots, { ...extra, contents: 'x' }] } : p,
      ),
    };
    expect(await verify(r.bytes, check, more)).toMatchObject({ ok: false, reason: 'annotations' });
    // An encrypted file is not a removal.
    expect(await verify(r.bytes, { kind: 'remove' }, r.expected)).toMatchObject({
      ok: false,
      reason: 'still-encrypted',
    });
    await close(doc);
  });
});
