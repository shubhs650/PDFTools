# ADR-016: M4-01 — Page operations: PDFium calls, narrow save, undo and cache invalidation

- **Status:** Proposed (decisions 3, 5 and 7 need the owner)
- **Date:** 2026-09-29
- **Deciders:** Owner; recorded by the coding agent
- **Related decisions:** D-06, D-09, D-10, D-19, D-24 (ARCHITECTURE.md §3.1, §4.2, §4.3, §7.8);
  ADR-001 B11/B14, ADR-004, ADR-005, ADR-011, ADR-012, ADR-013, ADR-014; M4-Q1, M4-Q2, M4-Q8;
  CLAUDE.md rules 1, 2, 7, 9
- **Related spike / milestone:** M4-01 (spike S14, `spikes/s14-pages/`), feeds M4-09 … M4-11
- **Outcome (spikes only):** **Works with workaround.** Every operation exists in PDFium and saves
  as a small, qpdf-clean incremental revision once the dirty set is computed by comparing objects
  (the tracker never sees page operations). Four things need our own code: EmbedPDF's page cache
  is keyed by page index and goes stale; the viewer has no "replace the page list" action and the
  annotation plugin loses annotations that change page; today's save verification cannot see page
  order; deleted pages leave dangling destinations and form fields.

## Context

§7.8 asks for rotate, delete, insert (blank / from file), extract to a new PDF, merge and reorder,
and §7.1 promises undo per document. M4-Q1 (accepted) makes each page operation one undo step,
restored by reopening **original + the narrow tail taken just before the operation**; M4-Q8
(accepted) opens merge/extract results as new unsaved tabs. The spike had to establish, before
any UI (see [M4 plan §M4-01](../plan/M4.md)):

- which calls perform each operation (EmbedPDF 2.15.1 engine or direct exports, B14);
- whether Ctrl+S stays narrow (ADR-005, rule 7), verifies and is qpdf-clean, for xref-table,
  object-stream, nested page-tree, encrypted and signed originals;
- what a deleted page leaves behind and what an import carries;
- what the viewer plugins (ADR-011, ADR-014) do when the page list changes;
- the cost of the undo route and of the operations on the 2,000-page stand-in and the A0 sheet;
- every cache keyed by page index that must follow an operation.

## Setup

- **Node harness** `spikes/s14-pages/run-node.ts`: the PDFium WASM the workers load, EmbedPDF's
  `PdfiumNative`, our `SaveTracker`, `narrowTail`, `digestDocument` / `compareDigests`
  (ADR-005's verification), `PdfReader` and `checkSignatures`. Every saved file goes through
  `qpdf --check` and is reopened; each page's identity (page object number, first text, rotation,
  size, annotation count) is compared with the live document.
- **Semantic dirty set** `spikes/s14-pages/semdiff.ts`: parses each object in PDFium's
  `FPDF_INCREMENTAL` output and compares it with the base's version (strings decrypted, numbers by
  value, stream data compared after Flate decoding, because PDFium re-encodes unfiltered content
  streams once it has loaded them). Only changed or new objects are kept.
- **Viewer probe** `spikes/s14-pages/plugins-node.ts`: the plugins that hold per-page state
  (document manager, viewport, scroll, selection, history, annotation, as in
  `src/features/view/plugins.ts`) in Node over the `PdfEngine` orchestrator.
- **Fixtures (self-made, rule 13):** `simplePdf(10)` as written (xref table), the same through
  `qpdf --object-streams=generate`, a 30-page balanced page tree with an inherited `/Rotate`, AES-256
  and RC4-128 variants opened with the owner password, the PKI.js-signed page, `outlinedPdf`,
  `fullFormPdf`, a 3-page source with a `/VP`, a Square annotation, a widget, `/PageLabels` and a
  landscape `/Rotate 90` page, the 2,000-page contract stand-in and a 3-page A0 sheet with 200k
  segments.
- **Environment:** Node 22, 4-core container. Timings are indicative; the Render worker in the
  browser is slower than Node by roughly 1.5–2× (ADR-004).

## Findings

1. **APIs.** EmbedPDF 2.15.1's engine has `deletePage`, `importPages`, `extractPages`,
   `createDocument` and `mergePages`, but **no rotate, move or insert-blank**, and its
   `extractPages` saves with EmbedPDF's own copy-out rather than our writer (ADR-005 d3). The
   bundled PDFium exports everything: `FPDFPage_SetRotation`, `FPDFPage_Delete`, `FPDFPage_New`,
   `FPDF_MovePages`, `FPDF_ImportPagesByIndex`, `FPDF_CreateNewDocument`,
   `EPDFDoc_GetPageObjectNumberByIndex`. PDFium writes a deleted page as `N 0 obj null`.

2. **Saving.** 8 operations (two rotations; delete one, delete the first two; insert blank at both
   ends; move two pages to the front; move the first page to the end; import 3 pages with an
   annotation, a widget and a `/VP`; and a mix of a new markup + rotate + delete + insert) × 5
   originals = 40 cases, each saved two ways:

   | Save                                                  | qpdf    | Reopened pages identical | ADR-005 check  | Tail (10-page file) |
   | ----------------------------------------------------- | ------- | ------------------------ | -------------- | ------------------- |
   | keep-all (today: page ops are "untracked")            | 40 / 40 | 40 / 40                  | 40 / 40 ok     | 2.6–12.7 KB         |
   | **semantic narrow** (dirty = objects that changed)    | 40 / 40 | 40 / 40                  | 40 / 40 ok     | **0.3–4.8 KB**      |
   | negative control: page-tree node left out of the tail | —       | **0 / 2**                | **2 / 2 "ok"** | 0 B                 |
   - The semantic dirty set is small and exact: 1–4 changed objects per case (the `/Pages` node(s),
     rotated page dicts, deleted pages as `null`) plus the new objects of inserts and imports. It
     works on xref-stream / object-stream originals, nested trees (inherited `/Rotate` kept) and
     AES-256 / RC4-128 files (strings and streams re-encrypted by PDFium, compared decrypted).
   - 2,000-page stand-in, after deleting 1,000 pages, inserting 100, moving 500 and rotating the
     remaining 1,100: **keep-all 1.82 MB in 0.60 s; semantic narrow 0.24 MB in 0.17 s** (diff
     itself 79–124 ms over 3,100 appended objects); both qpdf-clean and identical on 10 sampled
     pages. A0 sheet (rotate one page, delete another): **keep-all 2.5 MB; narrow 413 B**.
   - **The ADR-005 check is blind to page order and rotation:** the negative control drops the page
     tree from the tail, so the saved file still has the old order, and `compareDigests` reports
     "ok" (its page digest is annotations and form values by index only).

3. **EmbedPDF's page cache is keyed by page index.** After `FPDFPage_Delete(0)`, `acquirePage(3)`
   returns the cached `FPDF_PAGE` of the old page 4 ("Page 4" instead of "Page 5"). Every render,
   text, annotation and save-tracker call that goes through `acquirePage` would hit the wrong page.
   Closing all of the document's cached pages (`pageCache.forceReleaseAll()`, private) fixes it; a
   page that was open while it was deleted closes without error.

4. **Viewer plugins.** The core reducer (2.15.1) defines `REFRESH_DOCUMENT` and `SET_PAGES` actions
   but handles **neither**. Re-dispatching `SET_DOCUMENT_LOADED` with a new document object (same
   id, re-indexed `pages`) works for scroll (page count and layout follow, ~1 ms for 6 pages) and
   makes the annotation plugin reload through `getAllAnnotations` — **but its `SET_ANNOTATIONS`
   reducer deletes an annotation whose page index changed** (it removes the page's old uids after
   adding the new ones, so a uid that moved from page 4 to page 3 is dropped): the store kept the
   uids in `pages` and lost them from `byUid`. **Workaround:** dispatch `SET_ANNOTATIONS` with an
   empty map first, then `SET_DOCUMENT_LOADED`; every annotation then lands on its new page.
5. **Undo (M4-Q1).** Taking the snapshot before the operation, then closing and reopening the
   document under the same id from original + snapshot, re-dispatching the old page list (with the
   workaround), restores the pages and the annotation store; an annotation created **before** the
   page operation is then undone correctly by `plugin-history` (LIFO: the page operation is undone
   first, so the earlier command's page index is valid again). Costs: reopen of the 2,000-page
   stand-in **0.49–0.56 s** (Node), A0 sheet 2–20 ms; the snapshot tail after heavy operations
   0.19–0.23 s with keep-all.
6. **Operation costs** (2,000-page stand-in, one Render-worker call each, Node): delete 1,000 pages
   0.28–0.33 s; insert 100 blank 4 ms; move 500 pages 47–49 ms; rotate 1,100 pages 0.44–0.54 s
   (`FPDFPage_SetRotation` needs a loaded page, so rotation parses each page); rotate + delete on the
   dense A0 sheet 0.14–0.25 s (page parse).
7. **What a delete leaves dangling** (valid PDF, qpdf-clean): a named destination (`/Dests`) and a
   link on a remaining page still point at the deleted page object; outline items not targeting
   deleted pages are fine. Deleting the form page of `fullFormPdf` leaves all 7 fields in
   `/AcroForm /Fields` with `/P` → the deleted page; `FPDF_GetFormType` still reports an AcroForm.
   `/PageLabels` are not renumbered.
8. **What an import carries** (`FPDF_ImportPagesByIndex`): the pages with their annotations
   (Square kept) **and widgets**, `/VP`, `/Rotate`; **not** the source's `/AcroForm` (the widget is
   orphaned, not a field of the destination), outlines or page labels. `extractPages` output has no
   `/AcroForm` either. Output qpdf-clean.
9. **Signed original.** Rotate + insert on the signed fixture saves narrow and verifies; the
   signature stays "unchanged since signing" with "changed after signing" set (as for markups).
   **Existing bug found:** after a **keep-all** save the Signatures pane's byte scan
   (`findSignatures`) lists the signature **twice**, because PDFium re-appends the `/Sig`
   dictionary. The semantic-narrow save does not re-append it. This affects today's keep-all
   fallback for any untracked change on a signed file.
10. **Permissions.** The tracker checks `deletePage` / `importPages` against **modify** (bit 4); §7.8
    and M4-Q2 need **assemble** (bit 11), which ADR-013's map already provides.

## Caches keyed by page index or page object (follow-up map for M4-09)

| Where                       | What                                                                                                                    | After a page operation                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Render worker, EmbedPDF     | `PageCache` (`FPDF_PAGE` + text page by index)                                                                          | `forceReleaseAll()` before and after (finding 3)                                            |
| Render worker, save tracker | `pages` (changed page indexes), staged object-layer patches (`PatchTarget.page`)                                        | re-key by page **object number**; staged `/VP` and measurement patches follow their page    |
| Render worker               | annotation ids `obj-<n>` (ADR-014)                                                                                      | unchanged (object numbers survive)                                                          |
| Work worker                 | document copy (original + tail), search text cache and background index, snap geometry                                  | push the new tail (`docs.refresh`), drop `search.cache` and `geometry` for the document     |
| Snap worker                 | per-page indexes (`<doc>/<page>` keys)                                                                                  | unload by document prefix                                                                   |
| Main thread, EmbedPDF core  | document `pages`, scroll layout, tiles, selection geometry (by index)                                                   | `SET_ANNOTATIONS {}` + `SET_DOCUMENT_LOADED` (finding 4); `REFRESH_PAGES` for rotated pages |
| Main thread, our stores     | thumbnails and tile/image cache, links, bookmarks, search results, comment numbers, scale/viewport store, measure store | clear per document and reload visible pages (comment numbers are derived: they follow)      |
| OPFS recovery               | narrow tail + UI state (page, zoom)                                                                                     | written after the operation like any change; page clamped to the new count                  |

## Options considered

1. **Keep page operations "untracked" (keep-all save).** Works today. Against: 10–1,000× larger
   tails, slower saves, the duplicated `/Sig` (finding 9), and recovery/undo snapshots of MBs.
2. **Track the page tree by hand** (mark `/Pages` nodes, rotated pages and deleted pages dirty from
   each operation). Against: every operation's side effects (inherited attributes, tree
   rebalancing, `null` objects) must be known in advance; a missed one loses data silently unless
   verification catches it (and today it would not, finding 2).
3. **Semantic dirty set** for any save after an untracked change: compare PDFium's appended objects
   with the base and keep what changed. Exact in all 40 cases, general (also covers future
   untracked mutations), costs ~0.1 s per 3,000 appended objects in the Render worker.

## Decision (proposed)

1. **Calls:** direct PDFium exports for rotate (`FPDFPage_SetRotation`), delete, insert blank
   (`FPDFPage_New`), move (`FPDF_MovePages`) and import (`FPDF_ImportPagesByIndex`) in the Render
   worker, each in a new Render RPC with progress and cancel between pages (rules 1, 2). Extract and
   merge build their new document **in the Work worker** (`FPDF_CreateNewDocument` +
   `FPDF_ImportPagesByIndex` + our writer, full rewrite), never on the Render queue.
2. **Saving:** option 3 — after an untracked change the tracker builds the narrow tail from the
   **semantic dirty set** (moved from `spikes/s14-pages/semdiff.ts` into
   `src/workers/render/save/`, with the S14 matrix as unit tests), instead of keep-all. Keep-all
   stays the verification fallback (ADR-005 d2).
3. _(Owner)_ **Verification:** extend ADR-005's page digest with each page's **object number,
   rotation and size**, and compare page order; for a save after a page operation the digest covers
   every page. The S14 negative control becomes a unit test that must fail. (Amends ADR-005 d2's
   comparison; no ARCHITECTURE.md change.)
4. **Page cache:** one function in `src/workers/render/pdfium.ts` (the only file that reaches into
   EmbedPDF internals) closes a document's cached pages; called before and after every page
   operation. `tests/engine/pdfium-access.test.ts` asserts `pageCache.forceReleaseAll` exists.
5. _(Owner)_ **Undo (M4-Q1 confirmed):** before each page operation the Render worker takes a
   semantic-narrow snapshot tail (kept in its memory, bounded to 256 MB per session, oldest
   page-operation undo steps dropped first with a message); undo closes and reopens the document
   under the same id from original + that tail, and the main thread re-dispatches the old page
   list; redo repeats the operation. The page operation is one `plugin-history` command in the
   same timeline as annotations.
6. **Viewer refresh:** after an operation (or its undo) the main thread dispatches
   `ANNOTATION/SET_ANNOTATIONS {}` and then `SET_DOCUMENT_LOADED` with the new page list (finding 4),
   `REFRESH_PAGES` for rotated pages, and clears our per-document caches per the map above. The
   plugin bug is reported upstream; a unit test pins the workaround to 2.15.1.
7. _(Owner)_ **Dangling references on delete:** leave named destinations, links and outline items
   as they are (valid PDF; other viewers do the same) and show them as "target page deleted" in our
   bookmarks pane and link layer; **remove fields whose widgets were all on deleted pages from
   `/AcroForm /Fields`** (object-layer patch on the AcroForm dictionary, new patch target); page
   labels are left as they are (a note in the delete dialog if the document has labels).
   Alternative: also rewrite outlines/links (more code, more risk).
8. **Imports and merges (M4-Q8):** imported widgets carry their appearance but are not fields of
   the destination (finding 8): the insert/merge dialog says "form fields are imported as
   non-fillable"; our own per-file bookmark for merges as accepted.
9. **Permissions:** page operations are checked against **assemble** (ADR-013 map) in the tracker
   and the UI (M4-Q2); `deletePage` / `importPages` leave the "modify" set in `mutations.ts`.

No ARCHITECTURE.md change: §7.8 and §4.2 already describe the behavior; this ADR only records how.

## Consequences

- **M4-09:** Render RPCs for the operations; the semantic dirty set in the tracker; the digest
  extension (decision 3); the page-cache purge; the viewer refresh with the plugin workaround;
  the cache map above as a checklist with an e2e per row; undo via snapshot + reopen; assemble
  permission. Perf gate: delete 1,000 of 2,000 pages and undo, no main-thread task > 100 ms (the
  browser-side `SET_DOCUMENT_LOADED` relayout for 2,000 pages is **not measured** in this Node
  spike and is the main thing M4-09's perf scenario must prove).
- **M4-10:** move = `FPDF_MovePages` (47 ms for 500 pages).
- **M4-11:** insert from file = import in the Render worker; extract/merge in the Work worker with
  our writer; per-file bookmarks via the object layer (new objects — M4-19/ADR-018 needs the same
  capability).
- **Existing bug (finding 9):** `findSignatures` must de-duplicate `/Sig` dictionaries by object
  number (latest revision wins). Fixed in M4-09 with a regression test; recorded in PROGRESS.
- **Risks:**
  - the annotation-plugin workaround and the page-cache purge depend on EmbedPDF 2.15.1 internals
    (pinned; tests assert them);
  - reopen-based undo costs ~0.5 s on 2,000 pages in Node (likely ~1 s in the browser): shown with
    progress (rule 2);
  - certification signatures (DocMDP) that forbid page changes are not enforced by PDFium; we warn
    as for markups (signatures are D-24 "integrity only") — to revisit if the owner wants a block;
  - memory: undo snapshots of large keep-all tails are avoided by decision 2; the cap in decision 5
    bounds the rest.

## Evidence

- Code: [`spikes/s14-pages/`](../../spikes/s14-pages/) — `run-node.ts` (matrix, cache, dangling,
  import, signed, timings), `semdiff.ts` (semantic dirty set), `plugins-node.ts` (viewer probe).
- Commands (Node 22, repo root, `qpdf` 11.9 installed):
  - `node --import ./spikes/shared/ts-ext.ts spikes/s14-pages/run-node.ts` → `out/s14-node.json`
  - `node --import ./spikes/shared/ts-ext.ts spikes/s14-pages/plugins-node.ts` → `out/s14-plugins.json`
- Inputs: self-made generators in `e2e/fixtures/generate.ts`, `encrypted.ts` (qpdf), `signed.ts`
  (PKI.js), plus the nested-tree and rich-source fixtures in `run-node.ts`. No owner files.
