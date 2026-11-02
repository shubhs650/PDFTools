// S18 — Password security (ADR-021 D-40 a). EmbedPDF 2.15.1's
// setDocumentEncryption / removeEncryption on our Render-worker executor:
// the algorithm actually written, opening with the user / owner passwords in
// PDFium and qpdf, each permission bit, removal, Unicode passwords, our object
// layer's staged keys under a new file key, a signed file, timings.
import { performance } from 'node:perf_hooks';
import { PdfPermissionFlag, type PdfDocumentObject } from '@embedpdf/models';
import { annotatedPdf, contractPdf, fullFormPdf, simplePdf } from '../../e2e/fixtures/generate.ts';
import { makeSigner, signedPdf } from '../../e2e/fixtures/signed.ts';
import { allows, CAPABILITIES } from '../../src/model/permissions.ts';
import { D, N, S, type PdfValue } from '../../src/model/pdf/objects.ts';
import { checkSignatures } from '../../src/workers/work/signatures.ts';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';
import {
  annotCounts,
  annotsOf,
  closeDoc,
  docPtrOf,
  exec,
  mod,
  ms,
  native,
  obj,
  openDoc,
  openPlain,
  pageOf,
  permissionsOf,
  qpdf,
  qpdfCheck,
  qpdfJson,
  qpdfTrailer,
  securityRevision,
  tracker,
} from './harness.ts';

const slice = { signal: new AbortController().signal, checkpoint: () => Promise.resolve() };
const USER = 'open-Pw1';
const OWNER = 'owner-Pw2';
const ALL = PdfPermissionFlag.AllowAll;

interface EncryptFacts {
  setResult: unknown;
  ms: number;
  bytes: number;
  encrypt: Record<string, unknown> | string;
  pdfVersion: string;
}

/** Encrypt the open document and write it with the Save As (full rewrite) path. */
async function encrypt(
  doc: PdfDocumentObject,
  user: string,
  owner: string,
  flags: number,
): Promise<{ bytes: Uint8Array; facts: EncryptFacts }> {
  const t0 = performance.now();
  const setResult = await exec('setDocumentEncryption', doc, user, owner, flags);
  const bytes = tracker.saveRewrite(doc.id);
  const t = ms(t0);
  let d: ReturnType<typeof describe>;
  try {
    d = describe(bytes, owner);
  } catch (e) {
    d = { encrypt: `qpdf: ${(e as Error).message}`, pdfVersion: '?' };
  }
  return { bytes, facts: { setResult, ms: t, bytes: bytes.length, ...d } };
}

function describe(
  bytes: Uint8Array,
  owner: string,
): { encrypt: Record<string, unknown> | string; pdfVersion: string } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 9));
  const trailer = qpdfTrailer(bytes, owner);
  const encRef = trailer['/Encrypt'];
  if (typeof encRef !== 'string') return { encrypt: 'none', pdfVersion: head };
  const j = qpdfJson(bytes, owner);
  const enc = obj(j, encRef.replace(/^(\d+) (\d+) R$/, '$1 $2 R'));
  const pick: Record<string, unknown> = {};
  for (const k of ['/Filter', '/V', '/R', '/Length', '/P', '/StmF', '/StrF', '/EncryptMetadata'])
    if (enc && k in enc) pick[k] = enc[k];
  const cf = enc?.['/CF'] as Record<string, Record<string, unknown>> | undefined;
  if (cf) pick['/CF'] = Object.fromEntries(Object.entries(cf).map(([k, v]) => [k, v['/CFM']]));
  return { encrypt: pick, pdfVersion: head };
}

const showEncryption = (bytes: Uint8Array, pw: string) =>
  qpdf(['--show-encryption', `--password=${pw}`], bytes)
    .out.split('\n')
    .filter((l) =>
      /R =|P =|User password|extract|print|modify|annotations|form|assembly|accessibility|stream|string|file/i.test(
        l,
      ),
    )
    .map((l) => l.trim());

async function opens(bytes: Uint8Array, pw?: string) {
  const r = await openPlain(bytes, pw);
  if ('error' in r) return { opened: false, error: r.error };
  const perms = permissionsOf(r.doc);
  const rev = securityRevision(r.doc);
  const out = {
    opened: true,
    pages: r.doc.pageCount,
    permissions: `0x${perms.toString(16)}`,
    revision: rev,
    allowed: CAPABILITIES.filter((c) => allows({ permissions: perms, revision: rev }, c)),
  };
  await native.closeDocument(r.doc).toPromise();
  return out;
}

export async function run(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // 1. Open + permissions password, everything but copy and modify allowed.
  {
    const src = annotatedPdf();
    const doc = await openDoc(src);
    const before = annotCounts(doc);
    const flags =
      PdfPermissionFlag.Print |
      PdfPermissionFlag.PrintHighQuality |
      PdfPermissionFlag.ModifyAnnotations |
      PdfPermissionFlag.FillForms |
      PdfPermissionFlag.ExtractForAccessibility |
      PdfPermissionFlag.AssembleDocument;
    const { bytes, facts } = await encrypt(doc, USER, OWNER, flags);
    await closeDoc(doc);
    const withUser = await openPlain(bytes, USER);
    const after = 'doc' in withUser ? annotCounts(withUser.doc) : null;
    if ('doc' in withUser) await native.closeDocument(withUser.doc).toPromise();
    out.openAndPermissions = {
      ...facts,
      flagsAsked: `0x${flags.toString(16)}`,
      noPassword: await opens(bytes),
      wrongPassword: await opens(bytes, 'nope'),
      userPassword: await opens(bytes, USER),
      ownerPassword: await opens(bytes, OWNER),
      qpdfCheckUser: qpdfCheck(bytes, USER),
      qpdfCheckOwner: qpdfCheck(bytes, OWNER),
      qpdfShowEncryption: showEncryption(bytes, OWNER),
      annotCountsBefore: before,
      annotCountsAfter: after,
    };
  }

  // 2. Permissions password only (no open password).
  {
    const doc = await openDoc(simplePdf(2));
    const { bytes, facts } = await encrypt(doc, '', OWNER, PdfPermissionFlag.Print);
    await closeDoc(doc);
    out.permissionsOnly = {
      ...facts,
      noPassword: await opens(bytes),
      ownerPassword: await opens(bytes, OWNER),
      qpdfCheck: qpdfCheck(bytes),
    };
  }

  // 3. Each permission bit alone: what /P says, what PDFium reads, what our gate allows.
  {
    const rows: Record<string, unknown>[] = [];
    for (const [name, flag] of Object.entries(PdfPermissionFlag)) {
      if (typeof flag !== 'number' || name === 'AllowAll') continue;
      const doc = await openDoc(simplePdf(1));
      const { bytes, facts } = await encrypt(doc, '', OWNER, flag);
      await closeDoc(doc);
      const o = await opens(bytes);
      rows.push({
        flag: name,
        asked: flag,
        P: (facts.encrypt as Record<string, unknown>)['/P'],
        pdfiumPermissions: 'permissions' in o ? o.permissions : null,
        allowed: 'allowed' in o ? o.allowed : null,
      });
    }
    const doc = await openDoc(simplePdf(1));
    const { bytes, facts } = await encrypt(doc, '', OWNER, 0);
    await closeDoc(doc);
    const none = await opens(bytes);
    rows.push({
      flag: 'none',
      asked: 0,
      P: (facts.encrypt as Record<string, unknown>)['/P'],
      allowed: 'allowed' in none ? none.allowed : null,
    });
    out.permissionBits = rows;
  }

  // 4. Calling it on an already encrypted document; then removeEncryption.
  {
    const doc0 = await openDoc(annotatedPdf());
    const { bytes: enc } = await encrypt(doc0, USER, OWNER, PdfPermissionFlag.Print);
    await closeDoc(doc0);

    // Opened with the user password only: restricted (no modify).
    const restricted = await openDoc(enc, USER);
    let gate: string;
    try {
      tracker.checkAllowed('removeEncryption', restricted.id);
      gate = 'allowed';
    } catch (e) {
      gate = `refused: ${(e as Error).message}`;
    }
    // What PDFium itself does if asked anyway (our gate is the only guard?).
    const rawRemove = await native.removeEncryption(restricted).toPromise();
    const rawBytes = tracker.saveRewrite(restricted.id);
    const rawResult = describe(rawBytes, OWNER);
    const reEncrypt = await native
      .setDocumentEncryption(restricted, '', 'x', ALL)
      .toPromise()
      .catch((e: unknown) => `rejected ${JSON.stringify((e as { reason?: unknown }).reason)}`);
    await closeDoc(restricted);

    // Opened with the owner password: full rights → remove security.
    const full = await openDoc(enc, OWNER);
    const t0 = performance.now();
    const removed = await exec('removeEncryption', full);
    const plain = tracker.saveRewrite(full.id);
    const t = ms(t0);
    await closeDoc(full);
    const reopened = await openPlain(plain);
    const counts = 'doc' in reopened ? annotCounts(reopened.doc) : null;
    if ('doc' in reopened) await native.closeDocument(reopened.doc).toPromise();

    // Owner unlock after opening with the user password (the app's unlock flow).
    const unlocked = await openDoc(enc, USER);
    const unlock = await exec('unlockOwnerPermissions', unlocked, OWNER);
    let gateAfterUnlock: string;
    try {
      tracker.checkAllowed('removeEncryption', unlocked.id);
      gateAfterUnlock = 'allowed';
    } catch (e) {
      gateAfterUnlock = `refused: ${(e as Error).message}`;
    }
    const removedAfterUnlock = await exec('removeEncryption', unlocked);
    const plain2 = tracker.saveRewrite(unlocked.id);
    await closeDoc(unlocked);

    // Changing the passwords of an encrypted file (owner): set again on it.
    const again = await openDoc(enc, OWNER);
    const setOnEncrypted = await exec('setDocumentEncryption', again, 'new-user', 'new-owner', ALL);
    const changed = tracker.saveRewrite(again.id);
    await closeDoc(again);

    out.remove = {
      userOnlyGate: gate,
      userOnlyRawRemoveResult: rawRemove,
      userOnlyRawRemoveOutput: rawResult.encrypt,
      userOnlyRawReEncrypt: reEncrypt,
      ownerRemoveResult: removed,
      ownerRemoveMs: t,
      ownerRemoveOutput: describe(plain, OWNER).encrypt,
      ownerRemoveOpensWithoutPassword: await opens(plain),
      ownerRemoveQpdfCheck: qpdfCheck(plain),
      ownerRemoveAnnotCounts: counts,
      unlockResult: unlock,
      gateAfterUnlock,
      removedAfterUnlock,
      afterUnlockOutput: describe(plain2, OWNER).encrypt,
      changePasswords: {
        setResult: setOnEncrypted,
        output: describe(changed, 'new-owner').encrypt,
        oldUser: await opens(changed, USER),
        newUser: await opens(changed, 'new-user'),
        newOwner: await opens(changed, 'new-owner'),
        qpdfCheck: qpdfCheck(changed, 'new-owner'),
      },
    };
  }

  // 5. Incremental save after setDocumentEncryption (what Ctrl+S would write).
  {
    const src = simplePdf(1);
    const doc = await openDoc(src);
    await exec('setDocumentEncryption', doc, USER, OWNER, ALL);
    const st = tracker.dirtyState(doc.id);
    let incremental: unknown;
    try {
      const r = await tracker.save(doc.id);
      const bytes = new Uint8Array([...src, ...r.tail]);
      incremental = {
        mode: r.mode,
        tailBytes: r.tail.length,
        noPassword: await opens(bytes),
        trailerHasEncrypt: /\/Encrypt\s+\d+/.test(new TextDecoder('latin1').decode(r.tail)),
      };
    } catch (e) {
      incremental = `threw: ${(e as Error).message}`;
    }
    await closeDoc(doc);
    out.incrementalAfterEncrypt = { dirtyState: st, incremental };
  }

  // 6. Unicode passwords (AES-256 /R 6 takes SASLprep'd UTF-8).
  {
    const rows: Record<string, unknown>[] = [];
    for (const pw of [
      'pässwörd',
      'パスワード',
      'pass word',
      'x'.repeat(127),
      'x'.repeat(128),
      'é'.repeat(64),
    ]) {
      const doc = await openDoc(simplePdf(1));
      const { bytes, facts } = await encrypt(doc, pw, `${pw}-owner`, ALL);
      await closeDoc(doc);
      const q = qpdf(['--check', `--password=${pw}`], bytes);
      rows.push({
        password:
          pw.length > 20
            ? `${String(pw.length)} chars, ${String(new TextEncoder().encode(pw).length)} UTF-8 bytes`
            : pw,
        setResult: facts.setResult,
        pdfiumOpensUser: (await opens(bytes, pw)).opened,
        pdfiumOpensOwner: (await opens(bytes, `${pw}-owner`)).opened,
        qpdfOpensUser: q.status === 0 || q.status === 3,
        qpdfMessage: q.out.split('\n').slice(-1)[0],
        encrypt: facts.encrypt,
      });
    }
    out.unicodePasswords = rows;
  }

  // 7. Our object layer's staged keys (/Measure etc., ADR-007) under the new file key.
  {
    const doc = await openDoc(annotatedPdf());
    const pi = annotCounts(doc).findIndex((n) => n > 0);
    const annots = pi >= 0 ? await annotsOf(doc, pi) : [];
    const a = annots[0];
    let measure: unknown = 'no annotation';
    if (a) {
      tracker.stagePatch(
        doc.id,
        { page: a.pageIndex, annot: a.id },
        new Map<string, PdfValue>([
          ['IT', N('PolygonDimension')],
          ['Measure', D({ Type: N('Measure'), Subtype: N('RL'), R: S('1 mm = 1 mm') })],
        ]),
        [],
      );
      await exec('setDocumentEncryption', doc, USER, OWNER, ALL);
      const bytes = tracker.saveRewrite(doc.id);
      const j = qpdfJson(bytes, OWNER);
      const found = Object.entries(j.qpdf[1])
        .map(([, v]) => (v.value ?? v.stream?.dict) as Record<string, unknown> | undefined)
        .find((v) => v && typeof v === 'object' && '/Measure' in v);
      const m = found?.['/Measure'] as Record<string, unknown> | undefined;
      measure = {
        measureR: m?.['/R'],
        expected: 'u:1 mm = 1 mm',
        qpdfCheck: qpdfCheck(bytes, OWNER),
      };
    }
    await closeDoc(doc);
    out.objectLayerUnderNewKey = measure;
  }

  // 7b. The workaround: rewrite the current state first (patches under the file's
  // own key), open that copy as a separate document, encrypt / decrypt it there,
  // rewrite again. PDFium parses our keys and re-encrypts them; the open
  // document is never touched.
  {
    const measureOf = (bytes: Uint8Array, pw: string) => {
      const j = qpdfJson(bytes, pw);
      const found = Object.values(j.qpdf[1])
        .map((v) => (v.value ?? v.stream?.dict) as Record<string, unknown> | undefined)
        .find((v) => v && typeof v === 'object' && '/Measure' in v);
      return (found?.['/Measure'] as Record<string, unknown> | undefined)?.['/R'];
    };
    const stage = async (doc: PdfDocumentObject) => {
      const pi = annotCounts(doc).findIndex((n) => n > 0);
      const a = pi >= 0 ? (await annotsOf(doc, pi))[0] : undefined;
      if (!a) throw new Error('no annotation');
      tracker.stagePatch(
        doc.id,
        { page: a.pageIndex, annot: a.id },
        new Map([['Measure', D({ Type: N('Measure'), Subtype: N('RL'), R: S('1 mm = 1 mm') })]]),
        [],
      );
    };
    const viaCopy = async (
      current: Uint8Array,
      openPw: string | undefined,
      step: (copy: PdfDocumentObject) => Promise<unknown>,
    ) => {
      const t0 = performance.now();
      const r = await openPlain(current, openPw);
      if ('error' in r) throw new Error(`copy did not open: ${String(r.error)}`);
      await step(r.doc);
      const out = saveWithFlags(mod, docPtrOf(native, r.doc.id), FPDF_NO_INCREMENTAL);
      await native.closeDocument(r.doc).toPromise();
      return { out, ms: ms(t0) };
    };

    // Apply: plain source with a staged /Measure.
    const doc = await openDoc(annotatedPdf());
    await stage(doc);
    const current = tracker.saveRewrite(doc.id);
    await closeDoc(doc);
    const enc = await viaCopy(current, undefined, (c) =>
      native.setDocumentEncryption(c, USER, OWNER, ALL).toPromise(),
    );

    // Remove: encrypted source opened with the owner password, a staged /Measure.
    const encSrc = await openDoc(enc.out, OWNER);
    await stage(encSrc);
    const directRemove = await exec('removeEncryption', encSrc);
    const direct = tracker.saveRewrite(encSrc.id);
    await closeDoc(encSrc);
    const encSrc2 = await openDoc(enc.out, OWNER);
    await stage(encSrc2);
    const current2 = tracker.saveRewrite(encSrc2.id);
    await closeDoc(encSrc2);
    const dec = await viaCopy(current2, OWNER, (c) => native.removeEncryption(c).toPromise());

    out.objectLayerViaCopy = {
      apply: {
        measureR: measureOf(enc.out, OWNER),
        ms: enc.ms,
        qpdfCheck: qpdfCheck(enc.out, OWNER),
      },
      removeDirect: { result: directRemove, measureR: measureOf(direct, '') },
      removeViaCopy: {
        measureR: measureOf(dec.out, ''),
        ms: dec.ms,
        qpdfCheck: qpdfCheck(dec.out),
      },
    };
  }

  // 8. A form and a signed file.
  {
    const doc = await openDoc(fullFormPdf());
    const { bytes } = await encrypt(doc, USER, OWNER, ALL);
    await closeDoc(doc);
    const r = await openPlain(bytes, USER);
    let fields: unknown = null;
    if ('doc' in r) {
      const w = await native.getPageAnnoWidgets(r.doc, pageOf(r.doc)).toPromise();
      fields = w.map((x) => `${x.field.name}=${x.field.value}`);
      await native.closeDocument(r.doc).toPromise();
    }
    out.formSurvives = { fields, qpdfCheck: qpdfCheck(bytes, USER) };

    const signer = await makeSigner('S18 Signer');
    const signed = await signedPdf(signer);
    const sd = await openDoc(signed);
    const sigBefore = await checkSignatures(new Uint8Array(signed), slice, () => undefined);
    const { bytes: encSigned } = await encrypt(sd, '', OWNER, ALL);
    await closeDoc(sd);
    const sigAfter = await checkSignatures(encSigned, slice, () => undefined).catch((e: unknown) =>
      String(e),
    );
    out.signedFile = {
      before: summarizeSigs(sigBefore),
      after: typeof sigAfter === 'string' ? sigAfter : summarizeSigs(sigAfter),
    };
  }

  // 9. Timing: the 2,000-page stand-in.
  {
    const big = contractPdf(2000);
    const doc = await openDoc(big);
    const { facts } = await encrypt(doc, USER, OWNER, ALL);
    await closeDoc(doc);
    const doc2 = await openDoc(big);
    const t0 = performance.now();
    const plainRewrite = tracker.saveRewrite(doc2.id);
    const plainMs = ms(t0);
    await closeDoc(doc2);
    out.timing2000 = {
      inputBytes: big.length,
      encryptAndRewriteMs: facts.ms,
      outputBytes: facts.bytes,
      plainRewriteMs: plainMs,
      plainRewriteBytes: plainRewrite.length,
    };
  }
  return out;
}

function summarizeSigs(sigs: unknown): unknown {
  if (!Array.isArray(sigs)) return sigs;
  return sigs.map((s: Record<string, unknown>) => ({
    integrity: s.integrity,
    coversWholeFile: s.coversWholeFile,
  }));
}
