// Password Security's check (M6-12, §7.12, ADR-022 decision 2), in the Work
// worker before anything is written: the output reopened by PDFium as a
// throwaway document — refused without the open password, opened with it
// with exactly the permissions asked for, opened with the permissions
// password with full rights, AES-256 — and its pages, comments and form
// fields compared with the Render worker's digest of the state it was made
// from. Removal: opens without a password, not encrypted, same digest.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfErrorCode } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { AES256_REVISION } from '../../model/passwordSecurity';
import { allows, CAPABILITIES, type Capability } from '../../model/permissions';
import { docPtrOf, rawCall } from '../render/pdfium';
import { digestDocument, type DocDigest } from '../render/save/digest';
import type { JobSlice } from './scheduler';
import { compareDigests, type MismatchReason } from './verifySave';

export type SecurityCheck =
  | { kind: 'encrypt'; userPassword: string; ownerPassword: string; allowed: Capability[] }
  | { kind: 'remove' };

export type SecurityMismatch =
  | 'opens-without-password'
  | 'user-password'
  | 'owner-password'
  | 'permissions'
  | 'algorithm'
  | 'still-encrypted';

export type SecurityVerifyResult =
  { ok: true } | { ok: false; reason: SecurityMismatch | MismatchReason; page?: number };

/** Pages digested between checkpoints (cancellation, progress). */
const DIGEST_CHUNK = 50;

let seq = 0;
/** PDFium's "password required or incorrect" (FPDF_ERR_PASSWORD). */
const PASSWORD_ERROR: number = PdfErrorCode.Password;

interface Opened {
  id: string;
  close(): Promise<void>;
  revision: number;
  permissions: number;
  ownerUnlocked: boolean;
}

async function tryOpen(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  bytes: ArrayBuffer,
  password: string | undefined,
): Promise<Opened | { error: number }> {
  const id = `verify-security-${String(++seq)}`;
  try {
    const doc = await native
      .openDocumentBuffer(
        { id, content: bytes.slice(0) },
        password === undefined ? {} : { password },
      )
      .toPromise();
    const ptr = docPtrOf(native, id);
    return {
      id,
      revision: rawCall(mod, 'FPDF_GetSecurityHandlerRevision', ptr),
      permissions: rawCall(mod, 'FPDF_GetDocPermissions', ptr) >>> 0,
      ownerUnlocked: Boolean(rawCall(mod, 'EPDF_IsOwnerUnlocked', ptr)),
      close: async () => {
        await native.closeDocument(doc).toPromise();
      },
    };
  } catch (err) {
    const e = err as { code?: unknown; reason?: { code?: unknown } };
    const code = e.reason?.code ?? e.code;
    return { error: typeof code === 'number' ? code : PdfErrorCode.Unknown };
  }
}

async function digestAll(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  id: string,
  pageCount: number,
  slice: JobSlice,
  progress: (done: number, total: number) => void,
): Promise<DocDigest> {
  const out: DocDigest = { pageCount, pages: [] };
  for (let from = 0; from < pageCount; from += DIGEST_CHUNK) {
    await slice.checkpoint();
    const pages = Array.from(
      { length: Math.min(DIGEST_CHUNK, pageCount - from) },
      (_, i) => from + i,
    );
    const d = digestDocument(mod, native, id, pages);
    out.pageCount = d.pageCount;
    out.pages.push(...d.pages);
    progress(Math.min(from + DIGEST_CHUNK, pageCount), pageCount);
  }
  return out;
}

export async function verifySecured(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  bytes: ArrayBuffer,
  check: SecurityCheck,
  expected: DocDigest,
  slice: JobSlice,
  progress: (done: number, total: number) => void,
): Promise<SecurityVerifyResult> {
  const compare = async (password: string | undefined): Promise<SecurityVerifyResult> => {
    const o = await tryOpen(mod, native, bytes, password);
    if ('error' in o)
      return { ok: false, reason: check.kind === 'remove' ? 'still-encrypted' : 'owner-password' };
    try {
      if (check.kind === 'remove' && o.revision >= 0)
        return { ok: false, reason: 'still-encrypted' };
      if (check.kind === 'encrypt' && !o.ownerUnlocked)
        return { ok: false, reason: 'owner-password' };
      const pageCount = rawCall(mod, 'FPDF_GetPageCount', docPtrOf(native, o.id));
      const got = await digestAll(mod, native, o.id, pageCount, slice, progress);
      return compareDigests(expected, got);
    } finally {
      await o.close();
    }
  };

  if (check.kind === 'remove') return compare(undefined);

  const { userPassword, ownerPassword, allowed } = check;
  // 1. An open password keeps the file shut without it.
  if (userPassword !== '') {
    const none = await tryOpen(mod, native, bytes, undefined);
    if (!('error' in none)) {
      await none.close();
      return { ok: false, reason: 'opens-without-password' };
    }
    if (none.error !== PASSWORD_ERROR) return { ok: false, reason: 'user-password' };
  }
  await slice.checkpoint();
  // 2. With the open password (none: no password): AES-256 and the permissions asked for.
  const user = await tryOpen(mod, native, bytes, userPassword === '' ? undefined : userPassword);
  if ('error' in user) return { ok: false, reason: 'user-password' };
  try {
    if (user.revision !== AES256_REVISION) return { ok: false, reason: 'algorithm' };
    // A separate permissions password must not be given away by the open one.
    if (ownerPassword !== userPassword && user.ownerUnlocked)
      return { ok: false, reason: 'user-password' };
    const sec = { permissions: user.permissions, revision: user.revision };
    const want = new Set(allowed);
    if (CAPABILITIES.some((c) => allows(sec, c) !== want.has(c)))
      return { ok: false, reason: 'permissions' };
  } finally {
    await user.close();
  }
  await slice.checkpoint();
  // 3. With the permissions password: full rights, and the same pages, comments and fields.
  return compare(ownerPassword);
}
