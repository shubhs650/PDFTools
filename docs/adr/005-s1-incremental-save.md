# ADR-005: S1 — Incremental save and full rewrite through PDFium

- **Status:** Proposed. The spike result stands; decisions 2–6 need owner approval.
- **Date:** 2026-09-24
- **Deciders:** Owner (pending); recorded by the coding agent
- **Related decisions:** D-03, D-05, D-06, D-09, D-24 (ARCHITECTURE.md §4.2, §4.3); ADR-001 B11,
  B12, B14; ADR-002; ADR-004; CLAUDE.md rules 6, 7 and 9
- **Related spike / milestone:** M0-S1
- **Outcome (spikes only):** **Works with workaround.** PDFium's incremental save is reachable and
  keeps the original bytes, signatures and encryption intact. Used as is, it bloats files and
  damages files that have xref streams. The workaround is a small post-processing step that we own:
  the "narrow tail".

## Context

- §4.2 / D-06: Ctrl+S is an **append-only incremental save**. Save Optimized is a full rewrite.
- §4.3 / B11: recovery stores the original bytes once, plus the **incremental tail**.
- EmbedPDF exposes only `saveAsCopy()`. ADR-001 B14 allows direct PDFium calls.
- S1 has to show that both save modes work and preserve annotations, form values, encryption and
  signatures, and time them. See
  [M0 plan §S1](../plan/M0.md#s1--incremental-save--full-rewrite-save-through-embedpdfpdfium).

## Findings

All inputs are self-made (`spikes/s1-save/make-fixtures.ts`):

- plain, annotated and AcroForm files;
- object streams + xref stream (`objstm`);
- AES-256 (R6) and RC4-128 (R3) encryption with an owner password only: print and extract denied,
  annotate allowed;
- AES-256 with annotations denied;
- a detached CMS signature with a throwaway certificate.

Every edited file gets **one annotation per EmbedPDF tool**: 19 tools plus two cloud variants, 21
in total, including the image stamp.

1. **EmbedPDF's `saveAsCopy()` is a full rewrite.** It calls `PDFiumExt_SaveAsCopy` with no flags.
   Its output matches `FPDF_SaveAsCopy(FPDF_NO_INCREMENTAL)` in size. It also copies the result out
   of WASM **one byte at a time** with `getValue`: **1.1 s for 23 MB**, against ~0.1 s for the save
   itself.
2. **Direct `FPDF_SaveAsCopy(doc, writer, flags)` works.** We call it from our own worker with our
   own `FPDF_FILEWRITE` (a WriteBlock callback made with `addFunction`), copying out in bulk. We
   need the document pointer, which only a **private** field holds (`PdfiumNative.cache`;
   `docPtrOf()` in `save-core.ts`).
3. **`FPDF_INCREMENTAL` is correct but bloated.** The original bytes are an exact prefix, a new
   revision with `/Prev` is appended, `qpdf --check` passes, the signature still verifies, and
   encryption R, P and method are unchanged. However, **PDFium appends every object it has
   _loaded_, not only changed ones.** One annotation on the 23 MB, 1,152-page public catalogue:

   | Pages visited before saving | PDFium tail | Narrow tail |
   | --------------------------- | ----------- | ----------- |
   | 0                           | 0.5 MB      | 1,044 B     |
   | 50                          | 1.5 MB      | 1,044 B     |
   | 1,152 (thumbnails)          | **22.2 MB** | 1,044 B     |

   With that bloat, the 30 % growth prompt (§4.2) fires almost immediately, and the B11 recovery
   tail becomes as large as the file.

4. **The PDFium tail also re-serializes objects it did not edit, with small changes.** qpdf compared
   each such object in the original and in PDFium's tail, decrypted and with streams decoded (over
   26,000 objects). The only differences were:
   - float32 rounding (`-78.5417` → `-78.541702`);
   - `/P` written signed;
   - `/NM` added to annotations EmbedPDF had merely **read**;
   - one XMP stream re-encrypted.

   None of these is a user edit. Keeping the original bytes is more faithful than appending them.

5. **PDFium's incremental save damages files with an xref stream.** When the original's newest
   xref section is a cross-reference stream (PDF 1.5+, very common), PDFium's appended xref stream
   has no `/Type /XRef`, no `endobj`, and a `startxref` that points at the wrong offset. qpdf
   reports "file is damaged" and only opens it by reconstruction. It also replaces the permanent
   first `/ID` element, which the spec forbids (ISO 32000-1 §14.4).
6. **Full rewrite (`FPDF_NO_INCREMENTAL`):**
   - produces a valid file, garbage-collected (an unreferenced object is dropped) and
     Flate-compressed;
   - writes a classic xref and **no object streams**;
   - keeps encryption with the same R, P and method;
   - **breaks signatures**, as expected. That confirms the D-06 modal.
   - Timing: 23 MB takes 1.1–1.4 s.
7. **Annotations** (checked with PDFium's raw API after reopening):
   - All 21 tools are created. Each has an `/AP` appearance stream (CLAUDE.md rule 6), and all
     survive every save mode.
   - PDFium adds `/AcroForm` to the catalog when it generates some appearances. That is a hidden
     edit which the narrow tail must, and does, keep.
   - PNG stamps work for RGB and RGBA. An earlier "RGB rejected" result was a harness bug.
8. **Forms:** the text value and checkbox state persist in every mode.
9. **Permissions:** `FPDF_GetDocPermissions` on the modify-annotations-denied file lacks bit 6. The
   harness refuses to edit, and the saved file carries no new annotations (rule 9).
10. **Timing** (Chromium 141 in the cloud container, all in a worker, no main-thread long tasks):

    | Case                                   | PDFium save | + narrow   | OPFS `createWritable(keepExistingData)` append | Total        |
    | -------------------------------------- | ----------- | ---------- | ---------------------------------------------- | ------------ |
    | 11 KB file, 100 markups (2 × 5 runs)   | 5–11 ms     | ≤ 27 ms    | 2.6–4.4 ms                                     | **12–31 ms** |
    | signed / AES-256 / objstm, 100 markups | 6–14 ms     | ≤ 39 ms    | 3–4 ms                                         | 13–42 ms     |
    | 23 MB, 1 markup (2 runs)               | 113–147 ms  | 297–341 ms | **166–285 ms** for a 1 KB append               | 463–626 ms   |
    - `createWritable({ keepExistingData: true })` copies the whole file to a swap file before the
      write. Chrome does this for OPFS and for real-disk FSA handles alike, as §4.2 already notes.
      It will dominate Ctrl+S on the 500 MB contract; the owner measures that.
    - The **OPFS sync-access-handle** tail write (B11 recovery) takes **1–1.5 ms** at any file
      size.

## Options considered

1. **Use PDFium's incremental output as is.**
   - Against: bloat (finding 3), damaged xref-stream files (finding 5), and re-serialization noise
     (finding 4).
2. **Narrow tail: post-process PDFium's incremental output** (implemented in
   `spikes/s1-save/save-core.ts`, about 250 lines).
   - PDFium still serializes and encrypts every object. We only do three things:
     1. parse the appended objects sequentially, skipping stream data by `/Length`;
     2. keep what changed;
     3. write the xref section and trailer ourselves, as a table or an uncompressed xref stream,
        matching the original. `/Prev` points at the original's last section, and the permanent
        `/ID` is preserved.
   - An object is kept if it is:
     - new (`objnum ≥` the original `/Size`);
     - reported dirty by the edit layer (page, annotation, field or `/AcroForm` object numbers,
       from `EPDFAnnot_GetObjectNumber` and similar);
     - an existing object that now references a new one (this catches PDFium's hidden
       catalog/`/AcroForm` edit);
     - an indirect array referenced by a kept object.
3. **Our own full incremental writer** (the plan's "if it fails" option).
   - Against: we would serialize and encrypt objects ourselves. That is far more code and risk than
     option 2 for the same result.

## Decision

1. **Option 2 is the proposed Ctrl+S path.**
   - PDFium `FPDF_INCREMENTAL` via our writer, then the narrow tail, then an append to the handle.
   - The same tail is the B11 recovery tail and the Work-worker refresh.
2. _(Owner)_ **Safety net.**
   - Before reporting success, the Work worker (which has the original bytes) reopens the
     narrow-tail file and compares the dirty pages' annotations and form values with the Render
     worker's state.
   - On any mismatch, or if the tail cannot be parsed, fall back to **keep-all**: all of PDFium's
     appended objects, with **our** correct xref. Never use PDFium's own xref section.
   - The fallback is logged in the error report without document content (rule 10).
3. _(Owner)_ **Save Optimized** uses `FPDF_NO_INCREMENTAL` through our writer, not EmbedPDF's
   byte-by-byte `saveAsCopy`. "Compressed" in §4.2 means Flate streams. Object streams are not
   produced; revisit after M4 if size matters.
4. _(Owner)_ **EmbedPDF dependency.**
   - Keep the private `docPtrOf()` accessor behind one unit-tested function, pinned to 2.15.1.
   - Ask upstream for a public `saveAsCopy(doc, { flags })` or a document-pointer accessor, plus a
     bulk copy-out.
5. _(Owner)_ **Proposed ARCHITECTURE.md wording.** Apply only after this ADR is accepted.
   - §4.2, replace the "Spike M0-S1 must confirm…" paragraph with:
     > Ctrl+S calls PDFium `FPDF_SaveAsCopy(FPDF_INCREMENTAL)` in the Render worker, then keeps only
     > changed objects and writes its own xref section and trailer in the original's form (ADR-005).
     > The result is verified in the Work worker; on mismatch the full PDFium tail is used with our
     > xref. Save Optimized = `FPDF_NO_INCREMENTAL` (garbage-collected, Flate-compressed, no object
     > streams).
   - §4.3: "incremental-update tail" means the **narrow** tail.
6. _(Owner)_ **Large-file Ctrl+S cost.** The FSA append is O(file size) because of Chrome's swap
   file. Keep "measure and report" (ADR-002). Show save progress (rule 2) for files over ~50 MB.

## Consequences

- **M1 `/src/workers/render.worker.ts`:**
  - owns `saveWithFlags`, `narrowTail` and the dirty-set bookkeeping for every mutating RPC;
  - the Work worker owns verification.
  - Port the unit tests from `spikes/s1-save/save-core.test.ts`: tail parsing, table and stream
    xref writing, and signature `/Contents` DER extraction.
- **Annotation IDs:** EmbedPDF assigns `/NM` in memory to annotations that lack one. The narrow tail
  does not persist that for untouched annotations. Anything that must reference an annotation
  across sessions (replies, CRS rows) persists its `/NM` by marking it dirty on first reference.
- **D-24:** `spikes/s1-save/sig-verify.ts` (PKI.js) already checks ByteRange digest and signature
  integrity offline. It will seed the M3 signature panel.
- **Owner:**
  - run the interop checklist [`e2e/interop/CHECKLIST.md`](../../e2e/interop/CHECKLIST.md) on the
    committed pack `e2e/fixtures/self-made/s1-interop/`;
  - use the S1 page's **FSA button** to time a real-disk append on the 500 MB contract.
- **Risks:**
  - The keep rules are heuristics over PDFium's output. The verification and keep-all fallback bound
    the damage to "larger file", never "lost edit".
  - The object parser assumes PDFium's own tail format (direct `/Length`, no object streams in the
    tail), which it produced for every input here.

## Evidence

- **Code:** [`spikes/s1-save/`](../../spikes/s1-save/)
  - `save-core.ts`: writer, narrow tail, byte checks;
  - `annotations.ts`: one annotation per tool;
  - `sig-verify.ts`: PKI.js;
  - `run-node.ts`: correctness matrix, rewrite GC, tail growth, interop pack;
  - `save.worker.ts` + `s1.spec.ts`: browser timings with OPFS writes.
- **Commands:**
  1. `node spikes/s1-save/make-fixtures.ts && node spikes/s1-save/run-node.ts`: writes
     `out/results/s1-node.json`. It needs `qpdf` 11.9 (installed with apt; a CLI, not a dependency)
     and `openssl`.
  2. `SPIKE=s1 npm run spikes -- --project=s1`: 3/3 pass and writes `test-results/s1-results.json`.
  3. `npx vitest run spikes`: 8/8 unit tests pass.
- **Matrix result:** 8 inputs × 4 modes (EmbedPDF, PDFium incremental, narrow, rewrite).
  - qpdf is clean on every output except PDFium's raw incremental save of `objstm` (damaged xref
    stream).
  - Encryption R, P and method are unchanged everywhere.
  - The signature verifies after incremental and narrow saves, and is broken after rewrite.
  - Narrow output reopens to the **same state** (annotations and form values on every page, plus
    page-1 pixels) as PDFium's full incremental output.
- **Dependencies added:** `pkijs` 3.4.1 and `asn1js` 3.0.10 (BSD-3-Clause, planned for D-24). The
  license gate passes.
