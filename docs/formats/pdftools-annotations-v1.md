# PDFTools annotation export — JSON format, version 1

Written by Comment → Export Annotations (M4-08, §7.6, M4-Q7). Version 1 is also the **import**
format of Comment → Import Comments (M4-20, ADR-018). **Frozen** since M4-20 shipped: later
changes get a new `version`, and an import refuses a version it does not know.

- Encoding: UTF-8 JSON, one object. Dates are ISO 8601 strings in UTC. Page numbers are 1-based.
- Only comments are records (the Comments pane's set: markups, notes, stamps, measurements — not
  links, form fields or pop-ups). Replies and review states are nested in their comment.
- Nothing app-private is written into PDFs (rule 6); this file is a separate export.

```jsonc
{
  "format": "pdftools-annotations", // always this string
  "version": 1,
  "exported": "2026-09-29T12:00:00.000Z",
  "document": { "name": "plan.pdf", "pages": 12 },
  "annotations": [
    {
      "number": 1, // the Comments pane's number (M3-Q5): page, then creation date, then id
      "page": 1,
      "id": "…", // the annotation's /NM (EmbedPDF id)
      "type": "highlight", // EmbedPDF subtype name, lower-case
      "author": "Ana", // /T, or null
      "subject": null, // /Subj, or null
      "contents": "Move it", // /Contents, or null
      "created": "2026-01-02T00:00:00.000Z", // /CreationDate, or null
      "modified": null, // /M, or null
      "measure": { "kind": "distance", "value": "20.00 m" }, // measurements only (M3-16)
      "replies": [
        // in thread order; depth 0 = a reply to the comment
        {
          "id": "…",
          "inReplyTo": "…",
          "depth": 0,
          "author": "Bo",
          "contents": "Why?",
          "created": "…",
          "annotation": {}, // the reply's full model, as below
        },
      ],
      "states": [
        // review-state history (/StateModel /Review), oldest first
        { "id": "…", "author": "Bo", "state": "Accepted", "date": "…" },
      ],
      "annotation": {
        // EmbedPDF 2.15.1's annotation model, JSON-safe: geometry (rect, vertices,
        // segmentRects / quad points, ink paths), style (colours, opacity, border, cloud,
        // line endings, font), text, ids and reply links. Binary data and EmbedPDF's
        // private `custom` field are left out.
      },
    },
  ],
}
```

Notes:

- `annotation` holds what an import needs to re-create the markup with the same look through
  EmbedPDF (ADR-018 option 2). Image stamps' pictures are not included in version 1's export;
  an import re-creates them from a PDF source instead (ADR-018 option 1), or adds an optional
  `image` field (PNG data URI) before version 1 is frozen.
- Readers must ignore fields they do not know.

Import (M4-20) validates strictly: `format` and `version` as above; each record needs an integer
`page` ≥ 1, a non-empty `id`, a `type`, `author` string or null, ISO dates or null, arrays
`replies` (each with `id` and an `annotation`) and `states` (each with `id` and `state`), and an
`annotation` model with a numeric `type` and a finite `rect`. One bad record refuses the file.
Records keep their `id` as `/NM` (already in the document: skipped). Stamps are skipped (no
picture in v1), and measurements come in as plain markups (v1 has the value, not `/Measure`).
