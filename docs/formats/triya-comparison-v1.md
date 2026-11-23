# Triya PDF comparison file — format, version 1

**Status: version 1, written and read by M12-20** (from spike S31, M12-06; [ADR-032](../adr/032-m12-spike-results.md),
accepted 2026-11-22). Frozen once M12-20 ships: later changes get a new `version`, and the app
refuses a version it does not know. Fields may be added within version 1 only where an older
reader can ignore them (as `leadingPages`).

Written by **Save comparison…** (D-65, §7.16) and read when such a file is opened. A comparison
file is **one standard PDF** (rule 6): any reader shows its pages, its comments and its
attachments; Triya PDF also reopens it as the live comparison. Nothing in it is app-private
except the data attachment, which is plain JSON, and one page-piece dictionary, the place ISO
32000 sets aside for application data.

## The two kinds

|                       | PDF overlay (`kind: "overlay"`)                                                      | Text comparison (`kind: "text"`)                                                                      |
| --------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Pages                 | The **vector overlay** (S29, route 2), one page per sheet pair                       | **Document B's own pages**, with the changes as standard markups                                      |
| Comments on the pages | Overlay notes (the comparison's own comments, D-62)                                  | The change marks (below); never the reviewer's comments, which belong to A or B                       |
| Attachments           | Every file of side A and side B, **unchanged**, and the data                         | Document A, **unchanged**, and the data                                                               |
| Document B            | An attachment                                                                        | **The file's own first bytes** ("prefix"), checked by SHA-256                                         |
| Writing               | PDFium builds the pages; our object layer adds one section (attachments and catalog) | B's bytes as they are, then **one incremental section** by our object layer (marks, attachments, tag) |

## Catalog entries

Our object layer (`src/model/pdf`) rewrites the catalog in the section it appends. Everything
the catalog already had is kept.

```text
/Names << … /EmbeddedFiles <tree> >>      the file's own attachments kept; ours added (keys below)
/AF [ … <A> <B> <data> ]                  PDF 2.0 associated files; any existing entries kept
/PieceInfo << …
  /TriyaPDF <<
    /LastModified (D:20261122120000Z)
    /Private << /Type /TriyaComparison /Kind /Overlay | /Text /Version 1 /Data <data filespec> >>
  >>
>>
```

- **`/PieceInfo /TriyaPDF`** (ISO 32000-1 §14.5, page-piece dictionaries) marks the file as a
  comparison file. Other page-piece entries in the catalog are kept.
- The name tree is written as one leaf holding every key, sorted by byte value, so other
  readers find the file's own attachments as before.

### Attachment keys and file specifications

| Key in `/EmbeddedFiles`                          | What                         | `/AFRelationship` | `/Subtype` (stream)   |
| ------------------------------------------------ | ---------------------------- | ----------------- | --------------------- |
| `TriyaCompare-A`, or `TriyaCompare-A1`, `-A2`, … | Side A: one file, or a set   | `/Source`         | `/application#2Fpdf`  |
| `TriyaCompare-B`, or `TriyaCompare-B1`, …        | Side B (overlay; see below)  | `/Source`         | `/application#2Fpdf`  |
| `TriyaCompare-data`                              | The comparison data, as JSON | `/Data`           | `/application#2Fjson` |

Each file specification has `/Type /Filespec`, `/F` (the input's file name, non-ASCII
replaced by `_`), `/UF` (the real name), `/Desc` ("Document A (old revision), unchanged"),
`/EF << /F s /UF s >>` and `/AFRelationship`. Each embedded file stream has `/Type
/EmbeddedFile`, `/Filter /FlateDecode` and `/Params << /Size /CheckSum /ModDate >>`
(`/CheckSum` = MD5 of the file, as the standard says). The bytes inside are the input file
**exactly as it was opened**: never re-saved, never decrypted. An encrypted input stays
encrypted inside, with its own password.

A text comparison writes no `TriyaCompare-B` (B is the file itself), except on the
`unsigned` route below.

## The data (`comparison.json`)

UTF-8 JSON, one object. Dates are ISO 8601 in UTC. Page numbers are 1-based. Readers ignore
fields they do not know; a `version` higher than theirs is refused with a plain message.

```jsonc
{
  "format": "triya-comparison", // always this string
  "version": 1,
  "kind": "overlay", // or "text"
  "created": "2026-11-22T12:00:00.000Z",
  "modified": "2026-11-22T12:00:00.000Z", // last Save review or Save comparison…
  "app": "Triya PDF 1.1.0",
  "documents": {
    "A": [
      {
        "name": "RevA.pdf", // the input's file name
        "size": 13301, // bytes, as stored
        "sha256": "…", // hex, of exactly those bytes
        "pages": 1,
        "storage": { "attachment": "TriyaCompare-A" },
      },
    ],
    "B": [
      {
        "name": "RevB.pdf",
        "size": 3522,
        "sha256": "…",
        "pages": 1,
        // overlay: { "attachment": "TriyaCompare-B" }
        // text: B is the first `length` bytes of this file, `revisions` = its %%EOF count
        "storage": { "prefix": { "length": 3522, "revisions": 1 } },
      },
    ],
  },
  // overlay: one entry per sheet (a page of the file), in the pairing table's order
  "sheets": [
    {
      "a": [0, 0], // [index into documents.A, page index], or null (sheet only in B)
      "b": [0, 0], // or null (sheet only in A)
      "aToB": [1, 0, 0, 1, 0, 0], // A's display space → B's (D-60), absent when used as is
      "status": "asIs", // asIs | aligned | manual | lowConfidence
    },
  ],
  // overlay: the pairing table as edited (M12-09), indices into the side pages (all files of
  // a side in order, each file's page range applied)
  "pairing": [{ "a": 0, "b": 0 }, { "a": 1, "b": null, "excluded": true }],
  // overlay, an area comparison only (O1): the rectangle on A's page and on B's, displayed pt
  "area": { "a": [x0, y0, x1, y1], "b": [x0, y0, x1, y1] },
  // overlay: pages before the first sheet (an optional summary page, M12-21); 0 when absent
  "leadingPages": 0,
  // overlay: { style, thicken, layout, lock, vector, comments, layers: { A: { "<file index>":
  //   { "<OCG object number>": shown } }, B: … }, diff: { sensitivity, minSize, outlines } }
  // text: { run: { headersFooters, renumbering, bands, ocr }, colours, sync }
  "options": {},
  // overlay: { "sheet": 1-based compared sheet, or null for every sheet, "rect": [x0, y0, x1, y1] }
  // in the sheet's frame (B's displayed page, pt)
  "ignoreZones": [],
  "checked": [], // ticks in the list: overlay "<sheet>|<difference key>", text the change keys
  "closeOut": [
    // D-62: the old revision's comments and their outcome (also written into A as status
    // Completed plus a reply)
    { "nm": "…", "outcome": "carriedOver" }, // addressed | carriedOver | changedDifferently
  ],
  // text only: the marks, so the view draws them again without comparing again
  "marks": [
    {
      "page": 2, // page of B
      "kind": "replaced", // inserted | deleted | replaced | moved | figure | header | footer | renumbered | reference
      "quads": [[72, 700, 140, 700, 72, 688, 140, 688]], // B's user space, per line run
      "old": "1,450.00",
      "new": "1,520.00",
      "nm": "triya-cmp-17", // the /NM of its markup on B's page
    },
  ],
}
```

Each input also records `range` (the page range compared, as typed; empty for every page).
Alignments found automatically, the differences and the text result are worked out again on
opening (rules only, D-60, so they come out the same); a placement set by hand is restored from
`aToB`.

## Text comparison: Document B as the file's own bytes

```text
┌──────────────────────────────┬──────────────────────────────────────────────┐
│ Document B, byte for byte    │ our section: marks on B's pages, A attached, │
│ (all of its own revisions)   │ the data, the catalog with /PieceInfo        │
└──────────────────────────────┴──────────────────────────────────────────────┘
0                     length (in the data)                              end of file
```

- **Recovery:** B = the first `length` bytes, accepted only if their SHA-256 is the stored one.
  The data says how many `%%EOF` markers B has (`revisions`); our section is one more.
- **The section** is appended by the save core (`narrowTail`, "only our objects", ADR-016
  decision 2): new objects, B's page objects that get `/Annots`, and the catalog, with an xref
  section in B's own form (table or stream) and `/Prev` to B's. If B is encrypted, every new
  string and stream is encrypted with B's own key, so the comparison file opens with B's
  password and keeps B's permissions.
- **The marks** are standard markups with appearance streams, `/T (Triya PDF comparison)`,
  `/Subj` the kind, `/NM triya-cmp-<n>`:

  | Kind                         | Markup                                          | `/Contents`           |
  | ---------------------------- | ----------------------------------------------- | --------------------- |
  | inserted                     | `/Highlight`, green (multiply)                  | "Inserted"            |
  | replaced                     | `/Highlight`, amber                             | "was: 1,450.00"       |
  | moved                        | `/Highlight`, blue                              | "Moved"               |
  | deleted                      | `/Caret` at the place, red                      | "Deleted: <old text>" |
  | figure                       | `/Square`, blue frame                           | "Changed figure"      |
  | header, footer, renumbered … | as replaced or inserted, `/Subj` names the kind | as replaced           |

  B carries only the new text, so there is nothing on its pages to strike out: the old text is in
  the notes. Triya PDF draws the marks from the data and never treats them as comments.

- **Routes for a signed B** (ADR-032): an approval signature, or a certification that allows
  comments (`/DocMDP /P 3`), keeps the prefix route: the signature still covers its revision and
  other readers report "changed after signing" for the marks. A certification that forbids
  comments (`/P 1` or `2`) uses the **`unsigned`** route: the visible pages are PDFium's rewrite
  of B **without** its signature fields, and B is attached unchanged as `TriyaCompare-B` with its
  certification intact.

## Detecting and opening

1. Open the catalog only. `/PieceInfo /TriyaPDF /Private /Type /TriyaComparison` → a
   comparison file of `/Kind`, `/Version` (cost: under 1 ms; 4 ms on a 500-page file).
2. Fallback for a file whose catalog another program rewrote without `/PieceInfo`: an
   `/EmbeddedFiles` entry `TriyaCompare-data` whose JSON has `format: "triya-comparison"`.
3. Read the data, then each input; check every SHA-256.
4. States shown to the user:
   - **exact**: every input matches → the live comparison;
   - **changed in another program**: more `%%EOF` markers than B's plus ours (text), or
     comments on the overlay pages (overlay) → opened, and Save review warns before it rebuilds
     (text) what another program added after our section;
   - **B not exact** (text; another program rewrote the whole file): B cannot be given back
     byte for byte, so the file opens as the normal PDF it is (its marks and attachments still
     there), with a notice; (M12-20 does not offer a read-only comparison of such a file);
   - an input attachment missing or not matching, a newer `version` or data that cannot be
     read: the comparison cannot open; the file still opens as a normal PDF, with a notice.
5. The inputs open as documents of their own from the copies (the file's own password is tried
   first for an input that has one, then the input's own is asked); the comparison opens on its
   result in the file's place among the tabs, and the file's own tab closes. The comparison
   stays linked to the file for Save review.

## Saving into a comparison file (Save review)

- The reviewer's comments go into the **copies of A and B inside**, each by its own
  incremental section (rule 7: a signature in a copy stays valid).
- **Overlay:** the copies with their new sections, the data and the overlay notes (copied onto
  the overlay pages again) make a new file, written compacted over the comparison file (only
  the newest copies, ADR-032 decision 3). M12-20 rebuilds on Ctrl+S too rather than appending
  a section to the comparison file, so the file never holds stale copies.
- **Text:** B's new section must come straight after B, so the file is rebuilt: the new B, then
  a fresh section of ours. What another program appended after our section would be lost, so
  Save review warns first.

## Writing rules

- **Permissions (rule 9, D-58):** saving a comparison file needs the content-copying permission
  of every input; the text route also needs B's commenting permission (it writes markups into
  B's pages). An owner password unlocks.
- **A password-protected input** makes the comparison file password-protected too (AES-256,
  written by PDFium as Password Security does); otherwise its pages would show protected content
  without a password. Text files over an encrypted B already are (B's own encryption).
- The Save dialog says in plain words that the file **contains both documents**.
- Size: overlay ≈ the vector overlay (about A + B) + A + B; text ≈ B + A + about 0.7 KB per
  mark (S31).
