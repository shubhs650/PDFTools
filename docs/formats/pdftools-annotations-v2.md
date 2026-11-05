# Triya PDF annotation export — JSON format, version 2

Written by Comment → Export Comments → JSON since M8-01 ([ADR-025](../adr/025-m8-lossless-json-comments.md)),
and read by Comment → Import Comments. Version 2 is
[version 1](pdftools-annotations-v1.md) plus the comments' own PDF objects, so an import gives
back **exactly** the comments that were exported: every key, every appearance, stamps and their
pictures, attached files, sticky-note pop-up windows (place, size, open or closed), replies,
review states, measurements and their labels, and keys written by other viewers. Import still
reads version 1 files (re-created from the records, as before) and refuses any other version.

- Encoding: UTF-8 JSON, one object. Dates are ISO 8601 strings in UTC. Page numbers are 1-based.
- Readers must ignore fields they do not know.

```jsonc
{
  "format": "pdftools-annotations",
  "version": 2,
  "exported": "2026-11-05T12:00:00.000Z",
  "document": { "name": "plan.pdf", "pages": 12 },
  "annotations": [
    // exactly as in version 1: one record per comment with its replies, states and
    // EmbedPDF's annotation model — for people, scripts and spreadsheets
  ],
  "pdfPages": [1, 4], // the document page of each page of `pdf`, in order
  "pdf": "JVBERi0xLjcK…", // base64 (RFC 4648, padded) of a PDF: see below
}
```

## `pdf`

A small, unencrypted PDF made the way Copy makes the in-app clipboard (ADR-018, M4-21): one empty
page per document page that has exported comments (same crop box, as its media box, and the same
`/Rotate`), holding the exported comments (thread roots) with their replies, review states,
grouped parts (measurement labels), `/Popup`s and everything they reference (appearance streams
and resources, images, embedded files), copied as they are. Page `i` of this PDF is document page
`pdfPages[i]`.

`pdf` and `pdfPages` are written together. When `pdf` is present it is what an import uses: the
records choose which comments come in (page range, authors, types, statuses, replies, page offset;
duplicates by `/NM` are skipped) and those comments are copied from `pdf` by object copy, placed
as an import from a PDF places them (same position relative to the visible top-left of the crop
box). The records are informational then: editing a record's text in the JSON does not change
what is imported. Without `pdf` (version 1, or a version 2 file with both fields removed), an
import re-creates the comments from the records.

Validation on import: `pdf` must be standard padded base64 of something starting `%PDF-`,
`pdfPages` a non-empty array of integers ≥ 1; the PDF must open and allow copying. Anything else
refuses the file ("damaged").

Size: pictures and attached files are inside `pdf` (base64, about 4/3 of their size).
