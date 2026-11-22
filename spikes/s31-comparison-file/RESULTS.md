# Spike S31 — the comparison file (M12-06)

Task M12-06 of [docs/plan/M12.md](../../docs/plan/M12.md) (D-65; ADR-031). Input for **ADR-032
(M12 spike results)**, which this task also writes for the owner's acceptance. No feature code:
everything here is in `spikes/s31-comparison-file/`. The format it settles is written down as
[docs/formats/triya-comparison-v1.md](../../docs/formats/triya-comparison-v1.md).

**Verdict: works.** Both kinds of comparison file are written by the app's own object layer
and save core, open in PDFium, Poppler, pdf.js and qpdf without a complaint, and give every input
back **byte for byte** (SHA-256) in every case tried: 7 overlay files, 17 text pairs (the
500-page contract included), RC4, AES-128 and AES-256 inputs, approval-signed and certified
inputs, three rounds of Save review, and files saved again by other programs.

- **Text comparison: Document B's own bytes plus one appended section ("prefix").** B is
  recovered as the file's first `length` bytes and checked by SHA-256. Against the rewritten
  copy, the prefix route is **25 % to 45 % smaller** (B is not stored twice), keeps B's
  signature valid in the file itself (the rewritten copy breaks it: "Digest Mismatch" in
  Poppler), and keeps B's own encryption. The rewritten copy is rejected, except as the
  **"unsigned copy"** for a certified B whose permissions forbid comments (below).
- **Attachments and `/PieceInfo` by the object layer:** one embedded file per input (unchanged
  bytes, Flate, MD5 checksum), the data as `comparison.json`, the catalog tagged in
  `/PieceInfo /TriyaPDF`, and the file's own attachments kept. Detection reads only the catalog:
  **0.1–1 ms** on a plain file, **8 ms** on the 500-page comparison file.
- **Two things for the owner to decide** (ADR-032): a password-protected input should make the
  comparison file password-protected (otherwise the overlay pages show protected drawings to
  anyone), and Save review in a reopened comparison file rewrites the comparison file's own
  wrapper while Documents A and B inside keep incremental saves (rule 7).
- **Owner's check still open:** Acrobat Reader and a second desktop PDF editor, with the sample
  pack (below). The engines of Chrome and Edge (PDFium) and Firefox (pdf.js) are covered here.

## How it was tested

- **Writing** (`section.ts`): a `Section` on top of an existing file allocates object numbers
  after the base's, writes values and streams with `serializeIndirect` (strings and streams
  encrypted with the base's own key through `StandardCrypt` when the base is encrypted), and
  appends them with the save core's `narrowTail` in its "only our objects" mode (ADR-016
  decision 2), so the base's bytes are never touched and its xref form (table or stream) is
  kept. `embed()` writes an embedded file stream and its file specification; `tagCatalog()`
  merges our keys into `/Names /EmbeddedFiles` (one sorted leaf, existing entries kept), `/AF`
  and `/PieceInfo`.
- **Overlay files** (`build.ts`): S29's vector overlay builder (route 2) makes the pages, then
  one `Section` attaches A, B and the data. A set of three files per side was tried (pairs 01, 07
  and 08 as one set). With a protected input, `EPDF_SetEncryption` + a PDFium full save (the
  Password Security copy route, ADR-022) encrypts the whole file with AES-256.
- **Text files** (`build.ts`, `marks.ts`): words with boxes from PDFium, a stand-in comparison
  (Myers' algorithm on lines, then on words; **spike S30 owns the real method**), and the marks
  as standard markups with appearance streams (Highlight with Multiply, Caret for deleted text),
  all in one section on B. Three routes: **prefix**, **rewritten** (PDFium's full save of B, B
  attached too) and **unsigned** (the rewrite without B's signature fields, B attached).
- **Reading** (`read.ts`): `detect()` reads the catalog's `/PieceInfo` (fallback: the data
  attachment by name); `openComparison()` reads the data, recovers each input from its
  attachment or the prefix, checks each SHA-256, and counts revisions appended after ours.
- **Encrypted inputs:** text pairs 01 and 10 with B encrypted by qpdf (self-made copies) as
  AES-256, AES-128 and RC4-128, and AES-256 with commenting not allowed; overlay pair 12 (A owner
  password only, B user password `test1234`); A protected with its own password.
- **Signed inputs** (`sign.ts`): B of text pair 01 signed by our object layer with a throwaway
  key per run (`e2e/fixtures/signed.ts`): an approval signature and certifications with
  `/DocMDP /P` 1, 2 and 3. Overlay pair 01 with both inputs signed. Checked with the app's own
  `checkSignatures` and Poppler's `pdfsig`.
- **Save review** (`review.ts`): a sticky note appended to a copy as one incremental section
  (what Save review does to Document A or B), then the comparison file brought up to date.
- **Other programs saving the file:** a comment appended by another reader (an incremental
  section after ours), a full rewrite by PDFium and by qpdf (`--object-streams=generate`), and a
  catalog without our `/PieceInfo`.
- **Other engines** (outside the repository, never bundled): `qpdf --check`; Poppler
  `pdfdetach` (attachments saved and hashed), `pdftoppm` (marks drawn: coloured pixels of the
  page before and after) and `pdfsig`; pdf.js 4.10.38 in Node (`getAttachments`, annotations).

```sh
npx vitest run spikes/s31-comparison-file      # 5 unit tests, no PDFium
PDFJS_DIR=/path/with/node_modules/pdfjs-dist \
  node --import ./spikes/shared/ts-ext.ts spikes/s31-comparison-file/run-node.ts
                                               # → test-results/s31-node.json, out/pack/
```

Without `qpdf`, Poppler or `PDFJS_DIR` those checks say "skipped". Times are one Node process
on the cloud container, not the reference machine.

## Results: overlay comparison files

| Case                          | Sheets | Inputs (A + B) | Overlay pages only | Comparison file | ÷ inputs | Build (overlay + attach [+ encrypt]) ms | Detect / open ms | Inputs exact | qpdf | Poppler, pdf.js      |
| ----------------------------- | ------ | -------------- | ------------------ | --------------- | -------- | --------------------------------------- | ---------------- | ------------ | ---- | -------------------- |
| 01 flange                     | 1      | 13,301         | 10,307             | 22,504          | 1.69     | 131 + 19                                | 1.2 / 7.3        | yes          | ok   | 3 files, both exact  |
| 07 two sheets                 | 2      | 11,217         | 9,747              | 19,840          | 1.77     | 39 + 6                                  | 0.6 / 3.9        | yes          | ok   | 3 files, both exact  |
| 14 dense A1                   | 1      | 566,718        | 564,147            | 1,048,180       | 1.85     | 766 + 83                                | 0.3 / 16.9       | yes          | ok   | 3 files, both exact  |
| 19 review comments            | 1      | 17,117         | 9,726              | 22,660          | 1.32     | 19 + 3                                  | 0.3 / 3.0        | yes          | ok   | 3 files, both exact  |
| Set: 01 + 07 + 08 per side    | 6      | 43,852         | 36,601             | 72,719          | 1.66     | 121 + 11                                | 0.5 / 5.4        | yes          | ok   | 7 files, all 6 exact |
| 12 encrypted, file not locked | 2      | 10,885         | 9,013              | 20,501          | 1.88     | 65 + 28                                 | 0.2 / 2.5        | yes          | ok   | 3 files, both exact  |
| 12 encrypted, file AES-256    | 2      | 10,885         | 9,013              | 21,546          | 1.98     | 39 + 24 + 18                            | 249 / 282        | yes          | ok¹  | 3 files, both exact¹ |

Sizes in bytes. ¹ With the password; PDFium does not open it without.

**An overlay comparison file is about A + B twice over** (1.3 to 2 ×): the vector overlay is
about the size of the two sources (S29) and the sources are attached as they are. The data is a
few hundred bytes. Encrypted inputs stay encrypted inside; their attachments are the original
bytes and need their own passwords.

## Results: text comparison files, prefix against rewritten copy

| Pair     | Pages | Marks | A         | B         | Prefix file | Our section | Data (JSON) | Rewritten copy | Build ms | Detect / open ms | A and B exact | qpdf | Poppler / pdf.js | Coloured pixels, mark page (PDFium; Poppler) |
| -------- | ----- | ----- | --------- | --------- | ----------- | ----------- | ----------- | -------------- | -------- | ---------------- | ------------- | ---- | ---------------- | -------------------------------------------- |
| 01       | 1     | 10    | 3,424     | 3,522     | 16,416      | 12,894      | 3,126       | 19,181         | 6        | 0.2 / 2.0        | yes           | ok   | A exact / 10     | 4,681 → 9,305; 5,420 → 9,493                 |
| 02       | 2     | 20    | 58,224    | 62,453    | 129,406     | 66,953      | 6,760       | 179,046        | 20       | 0.2 / 2.8        | yes           | ok   | yes / 20         | 4,655 → 9,178; 5,547 → 9,708                 |
| 03       | 3     | 20    | 47,262    | 48,289    | 104,139     | 55,850      | 5,338       | 142,283        | 16       | 0.4 / 3.1        | yes           | ok   | yes / 20         | 1,170 → 2,099; 1,542 → 2,374                 |
| 04       | 3     | 9     | 5,613     | 6,065     | 22,717      | 16,652      | 4,974       | 27,053         | 9        | 0.3 / 2.4        | yes           | ok   | yes / 9          | 602 → 7,433; 1,010 → 7,578                   |
| 05       | 6     | 27    | 10,603    | 11,067    | 48,351      | 37,284      | 11,709      | 55,983         | 16       | 0.3 / 2.4        | yes           | ok   | yes / 27         | 504 → 770; 730 → 983                         |
| 06       | 2     | 10    | 4,151     | 4,777     | 19,631      | 14,854      | 4,612       | 22,981         | 5        | 0.2 / 1.4        | yes           | ok   | yes / 10         | 436 → 1,867; 700 → 1,947                     |
| 07       | 11    | 23    | 33,179    | 33,174    | 81,709      | 48,535      | 6,774       | 106,045        | 11       | 0.2 / 2.1        | yes           | ok   | yes / 23         | 6,221 → 6,924; 7,168 → 7,851                 |
| 08       | 3     | 6     | 109,853   | 111,524   | 180,477     | 68,953      | 2,078       | 244,678        | 10       | 0.2 / 3.0        | yes           | ok   | yes / 6          | 586 → 1,329; 1,046 → 1,671                   |
| 09       | 2     | 7     | 43,398    | 43,376    | 88,997      | 45,621      | 6,674       | 123,046        | 8        | 0.2 / 2.6        | yes           | ok   | yes / 7          | 546 → 813; 942 → 1,195                       |
| 10       | 18    | 30    | 59,269    | 60,581    | 135,517     | 74,936      | 17,060      | 176,612        | 21       | 0.4 / 3.5        | yes           | ok   | yes / 30         | 520 → 787; 883 → 1,135                       |
| 11       | 2     | 14    | 198,334   | 198,735   | 338,366     | 139,631     | 4,241       | 458,225        | 27       | 1.0 / 6.6        | yes           | ok   | yes / 14         | 3,493 → 6,429; 4,512 → 7,211                 |
| 12 (OCR) | 3     | 9     | 1,200,917 | 1,200,709 | 2,189,399   | 988,690     | 2,751       | 3,168,109      | 92       | 0.2 / 31.8       | yes           | ok   | yes / 9          | 0 → 798; 0 → 660                             |
| 13       | 7     | 18    | 11,139    | 12,406    | 42,762      | 30,356      | 11,795      | 53,697         | 10       | 0.2 / 1.9        | yes           | ok   | yes / 18         | 0 → 35; 0 → 24                               |
| 14       | 2     | 14    | 5,284     | 5,374     | 23,807      | 18,433      | 4,215       | 28,642         | 8        | 0.3 / 2.1        | yes           | ok   | yes / 14         | 0 → 14,661; 0 → 13,494                       |
| 15       | 5     | 8     | 8,993     | 7,684     | 32,263      | 24,579      | 6,218       | 38,813         | 6        | 0.2 / 1.5        | yes           | ok   | yes / 8          | 0 → 20; 0 → 12                               |
| 16       | 2     | 8     | 4,945     | 5,076     | 18,395      | 13,319      | 3,174       | 22,906         | 8        | 0.2 / 2.0        | yes           | ok   | yes / 8          | 0 → 3,120; 0 → 2,749                         |
| 17       | 500   | 571   | 743,420   | 743,772   | 1,904,694   | 1,160,922   | 136,910     | 2,543,378      | 271      | 8.4 / 36.9       | yes           | ok   | yes / 30²        | 0 → 9; 0 → 2                                 |

Sizes in bytes. Marks come from the stand-in comparison, not S30's method; their number is only
a load for the format. ² pdf.js was asked for the first 30 pages.

- **B is always the exact prefix**, and both inputs come back exact, on all 17 pairs.
- **The rewritten copy is 25 % to 45 % larger** (B is in the file twice) and gives nothing back:
  B still has to be attached to be recovered exactly.
- **Our section** is A (Flate-compressed; already compressed PDFs do not shrink), the data, and
  about **0.7 KB per mark** (the markup, its appearance stream, B's page objects with their new
  `/Annots`). The data holds the marks once more (a few hundred bytes each before compression)
  so the view can draw them without comparing again.
- **The marks are drawn** by PDFium (the app, Chrome, Edge) and Poppler: the coloured pixels of
  the first page with a mark grow in both, from 0 where B had no colour. pdf.js lists every mark
  as an annotation.
- **Time:** the section is written in 5–30 ms for ordinary documents, 92 ms for the 1.2 MB scan
  pair and 271 ms for the 500-page contract (in the Work worker: a progress-reported,
  cancellable job, rule 2). Opening and checking every input: 2–37 ms.

## Results: encrypted inputs

| Input                                       | Comparison file opens without / with the password (PDFium) | Inputs exact | qpdf (with password) | Poppler, pdf.js (with password) | Marks drawn |
| ------------------------------------------- | ---------------------------------------------------------- | ------------ | -------------------- | ------------------------------- | ----------- |
| Text 01 and 10, B AES-256 (R6)              | no / yes                                                   | yes          | ok                   | 2 files; all marks              | yes         |
| Text 01 and 10, B AES-128 (R4)              | no / yes                                                   | yes          | ok                   | 2 files; all marks              | yes         |
| Text 01 and 10, B RC4-128 (R3)              | no / yes                                                   | yes          | ok                   | 2 files; all marks              | yes         |
| Text 01, A AES-256 with its own password    | (B plain) yes                                              | yes          | ok                   | —                               | yes         |
| Overlay 12, A owner-only, B user `test1234` | yes / yes when not locked; no / yes when locked (AES-256)  | yes          | ok                   | 3 files                         | —           |

- **Text over an encrypted B:** our section is encrypted with B's own key (strings and streams,
  each crypt method), so the comparison file has B's password and B's permissions. Nothing new to
  ask the user.
- **An encrypted A** is attached as it is: it still needs its own password once taken out
  (checked: PDFium opens the recovered copy only with `userA`).
- **Overlay with a protected input:** the overlay pages are drawn from the decrypted inputs, so a
  comparison file that is not itself locked shows protected drawings to anyone (the "not
  locked" row opens without a password). Locking it with AES-256 through PDFium works and keeps
  every attachment exact. **Proposed rule (ADR-032):** when any input has an open password, Save
  comparison… must set one too.
- **AES-256 costs about 0.2–0.26 s to open** in our own reader (the R6 key derivation in
  JavaScript); RC4 and AES-128 under 10 ms. Once per file, in a worker.
- **Rule 9:** B with commenting not allowed (`--annotate=n`) still got marks in this spike; the
  feature must refuse the text comparison file for such a B unless its permissions password is
  given (the plan's rule already says the comparison file needs each file's flags).

## Results: signed inputs

| B of text pair 01            | Route        | The comparison file (ours; Poppler `pdfsig`)                                | B taken out of it                      |
| ---------------------------- | ------------ | --------------------------------------------------------------------------- | -------------------------------------- |
| Approval signature           | **prefix**   | unchanged, covers revision 2 of 3, changed after; "Signature is Valid"      | unchanged, revision 2 of 2; exact      |
| Approval signature           | rewritten    | modified; "Digest Mismatch"                                                 | unchanged (attached); exact            |
| Certified, `/P 3` (comments) | **prefix**   | unchanged, revision 2 of 3, changed after; "Signature is Valid"             | unchanged; exact                       |
| Certified, `/P 2`            | prefix       | as above, but the changes (comments, attachments) are not allowed by `/P 2` | unchanged; exact                       |
| Certified, `/P 2`            | **unsigned** | no signature in the file                                                    | unchanged, certification intact; exact |
| Certified, `/P 1`            | **unsigned** | no signature in the file                                                    | unchanged, certification intact; exact |
| Overlay 01, A and B signed   | attachments  | no signature on the overlay pages                                           | both unchanged; exact                  |

- **The prefix route keeps B's signature valid inside the comparison file**: the signed bytes
  are untouched and the marks come after, exactly as when anyone comments on a signed PDF.
  `pdfsig` does not judge DocMDP; Acrobat does, so the `/P 2` and `/P 1` cases are on the
  owner's checklist. By the standard, `/P 2` allows only form filling and signing and `/P 1`
  nothing, so a reader that checks will report the certification as broken by our section.
- **The unsigned route** (PDFium's rewrite of B without its signature fields, compacted so no
  signature object is left, B attached unchanged) shows no signature at all, so no reader can
  call it broken, and B's certification is intact in the attachment. It costs B twice in size.
- **Rewriting a signed B** without removing the signature makes every reader report a broken
  signature: never do that.

## Results: Save review into the copies inside

| Case                                       | Before                       | After                                      | Time             | Inputs exact | Notes                                                        |
| ------------------------------------------ | ---------------------------- | ------------------------------------------ | ---------------- | ------------ | ------------------------------------------------------------ |
| Overlay 19, round 1 / 2 / 3, incremental   | 22,660                       | 35,800 / 49,092 / 62,539                   | 7 ms each        | yes          | each round adds the full copies of A and B again             |
| Overlay 19, round 1 / 2 / 3, compacted     | 22,660                       | 22,944 / 23,102 / 23,257                   | 7–8 ms each      | yes          | only the newest copies are kept; qpdf ok; still detected     |
| Overlay 14 (dense A1), one round into B    | 1,048,180                    | incremental 1,291,274; compacted 1,048,303 | 32 / 38 ms       | yes          |                                                              |
| Overlay with signed A, review then compact |                              |                                            |                  | yes          | A's signature unchanged, covers revision 2 of 3              |
| Text 05 / 10 / 17, into A and B, rebuilt   | 48,351 / 135,517 / 1,904,694 | 49,670 / 136,869 / 1,905,880               | 17 / 28 / 247 ms | yes          | new B starts with the old B; the file starts with the new B  |
| Text 01 over an AES-256 B, into B          |                              |                                            |                  | yes          | B's section encrypted with its key; opens only with password |

- Every copy keeps its original bytes as a prefix (rule 7), so a signature in a copy survives
  Save review (checked).
- **Overlay:** appending new copies grows the file by every changed copy on every save; the
  PDFium compaction keeps the file at its size, costs about as much as the append, and keeps the
  copies exact and the file detectable.
- **Text:** B's new section must come straight after B, so the comparison file is rebuilt as
  "new B + a fresh section of ours". Our previous section is dropped (it is ours), the marks are
  written again from the data.

## Results: files saved by other programs

| What happened to the text comparison file of pair 01      | Detected by     | A exact | B exact | Revisions after ours |
| --------------------------------------------------------- | --------------- | ------- | ------- | -------------------- |
| Another reader added a comment (incremental)              | `/PieceInfo`    | yes     | yes     | 1                    |
| Rewritten by PDFium (full save)                           | `/PieceInfo`    | yes     | **no**  | —                    |
| Rewritten by qpdf (object streams)                        | `/PieceInfo`    | yes     | **no**  | —                    |
| Catalog without our `/PieceInfo` (a reader that drops it) | data attachment | yes     | yes     | 1                    |

- Both rewriters keep `/PieceInfo` and the attachments. A full rewrite loses B's exact bytes
  (the prefix is gone): the SHA-256 says so, and the comparison opens read-only with the pages as
  they are (spec, "Detecting and opening").
- A comment added by another reader is kept by its own section; a rebuild by Save review would
  drop it, so Save review warns first.
- Detecting a plain file costs **0.1 ms** (the dense A1 sheet); a newer `version` is refused
  with a message.

## Findings

1. **The prefix route is the right one for the text comparison file.** Smaller, keeps
   signatures and encryption, and B comes back byte for byte by length and SHA-256. The
   rewritten copy has no advantage left.
2. **The save core already does the hard part.** `narrowTail` in its "only our objects" mode
   appends a section in the base's own xref form; `StandardCrypt` encrypts new strings and
   streams with the base's key. The spike needed no new low-level code beyond the attachment and
   catalog helpers (about 250 lines).
3. **A certified B that forbids comments needs the unsigned route.** Appending comments and
   attachments is a change `/P 1` and `/P 2` do not allow; Acrobat will say so. Showing B without
   its signature and attaching the certified original is honest and readable everywhere.
4. **A protected input must make a protected comparison file** (overlay): the overlay pages are
   drawn from decrypted content.
5. **Overlay comparison files are about twice the inputs.** That is the price of "any reader
   sees the overlay" plus "Triya PDF gets the originals back". An "inputs only" file (no overlay
   pages) would halve it but other readers would see no overlay; not proposed for M12.
6. **Strike-outs on B's pages have nothing to strike.** B holds only the new text; replaced and
   deleted text lives in the notes ("was: …", "Deleted: …"), deletions marked by a caret. D-65's
   wording ("highlights, strike-outs and notes") becomes "highlights, carets and notes".
7. **`/PieceInfo` survives other programs' rewrites** (PDFium, qpdf); the data attachment by
   name is the fallback detection.
8. **Our reader needs about 0.25 s to open an AES-256 file** (key derivation); the app already
   pays this when the save tracker opens such a file, so the comparison should reuse that key.

## What the saving feature must do (M12-20)

1. `Section` (attachments, name tree merge, `/AF`, `/PieceInfo`) moves to `src/model/pdf` or the
   Work worker's save code, with these unit tests.
2. **Save comparison…** for overlay: S29's builder → one section (A, B, data) → AES-256 lock when
   an input had an open password; for text: B's bytes → one section (marks, A, data), with the
   unsigned route for `/P 1`–`2`, and refused when B forbids comments or copying (rule 9) unless
   unlocked.
3. **Reopen:** `detect()` on every open (catalog only); a comparison file opens as a comparison
   tab with "Open as a normal PDF" as the other choice; inputs checked by SHA-256; states as in
   the spec.
4. **Save review in a reopened file:** copies saved incrementally; overlay compacted (ADR-032
   decision), text rebuilt, with the warning when another program added revisions after ours.
5. **Export Document A / B** writes the recovered bytes as they are (the copies with any review
   comments).
6. The marks of the text file come from S30's result (page, quads, kind, old and new text).
   Quads from the line's full height (`FPDFText_GetLooseCharBox` or the font's ascent and
   descent): the spike used the tight glyph boxes, which make thin highlights.

## Risks

1. **Acrobat Reader and other desktop editors are not checked yet.** In particular: whether
   Acrobat lists attachments with `/AFRelationship` without complaint in a PDF 1.x file, how it
   reports the certified `/P 2` prefix file, and whether its own Save keeps our section and
   `/PieceInfo`. The sample pack covers these.
2. **Readers that rewrite on save** (most desktop editors on "Save As") lose B's exact bytes in a
   text comparison file. Detected, not prevented; the comparison then opens read-only.
3. **Large sets** make large overlay files (twice the inputs). The Save dialog should show the
   expected size.
4. **The marks here are a stand-in.** The number and shape of real marks come from S30; the
   format takes any kind (spec).
5. **`/PieceInfo /TriyaPDF` is not a registered name.** Registering a second-class name prefix
   with the ISO registry is free and optional; the data attachment is the fallback either way.

## The owner's check (sample pack)

`out/pack/` after a run, attached to the M12-06 thread (`/mnt/project-files/m12-06/`), with
`CHECKLIST.md`: overlay files (pair 01, a three-file set, the AES-256 locked pair 12 with password
`test1234`, pair 19 after three rounds of review), text files (pairs 01, 05 and 10; pair 01 as
the rewritten copy, over an AES-256 B with password `user1`, over an approval-signed B, over a
certified `/P 2` B by the prefix and the unsigned route; pair 05 after Save review). Open each in
Acrobat Reader and a second desktop PDF editor and check: no warning or repair message; the
attachments list and open; overlay colours; the marks and their notes; the signature panel; and
what happens when that reader saves a comment into the file.
