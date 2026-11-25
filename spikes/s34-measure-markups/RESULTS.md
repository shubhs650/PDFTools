# Spike S34 — every measurement kind as one markup (M14-01)

Task M14-01 of [docs/plan/M14.md](../../docs/plan/M14.md) (D-74; ADR-035). Input for **ADR-035
Amendment 1**. No feature code: the spike lives in `spikes/s34-measure-markups/`. The only change
outside the spike lets the object layer stage a page's `/PieceInfo` and `/LastModified`
(`src/workers/render/objects/patches.ts`). The measure corpus it uses is
`e2e/fixtures/measure-corpus/` → [`Synthetic PDF Corpus/measure/`](../../Synthetic%20PDF%20Corpus/measure/README.md).

**Verdict: works. The owner checked the pack in Acrobat Reader, the second desktop editor and Chrome or Edge on 2026-11-25: "Everything works well".** Every measurement kind saves as
**exactly one** standard annotation. The value is drawn into the markup's own appearance and is also
its `/Contents`, with no FreeText beside it. All 40 measurements of the pack read back whole from the page's
`/PieceInfo`, the data survives a later Ctrl+S, and the pack shows correctly in Chromium's own
PDF viewer (the Chrome and Edge viewer), on PDFium and on Poppler. The test file for the owner is
[`S34_interop_pack.pdf`](../../Synthetic%20PDF%20Corpus/measure/interop/S34_interop_pack.pdf).
His checklist is [OWNER-CHECK.md](OWNER-CHECK.md).

## The subtype for each kind

| Kind                  | Subtype (proposal)                                                                                                         | Why                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Length                | `/Line`, `/IT /LineDimension`, `/Cap true`, `/CP /Top` or `/Inline`, `/LL` `/LLE` `/LLO` for the offset (D-72), `/Measure` | The standard dimension line; the same shape another desktop editor writes (ADR-035 context).                                         |
| Polylength, Perimeter | `/PolyLine`, `/IT /PolyLineDimension`, `/Measure`                                                                          | Standard. A Perimeter closes by repeating its first vertex: PDF has no closed PolyLine.                                              |
| Area, Volume, Cutout  | `/Polygon`, `/IT /PolygonDimension`, `/Measure`, **no `/IC`**                                                              | Standard. The see-through fill exists only in our appearance, so a viewer that redraws never paints an opaque fill over the drawing. |
| Angle                 | `/Stamp` (alternative: `/PolyLine` of three points)                                                                        | No standard type. See "Redrawn by a viewer" below.                                                                                   |
| Radius, Diameter      | `/Stamp` (alternatives: `/Circle`, `/PolyLine`)                                                                            | No standard type; a Circle cannot hold a partial arc, and redraws wrongly.                                                           |
| Count                 | `/Stamp` (alternative: `/Square`)                                                                                          | One symbol and its number. A Square redraws as a box around both.                                                                    |
| Summary table         | `/FreeText` with its own table appearance                                                                                  | Text that viewers already list and print; its lines read in order if redrawn.                                                        |

Every measurement carries `/Subj` with the tool name ("Length", "Count"), `/NM`, `/Contents` with
the value as shown ("Office: 30,000 mm", "Door 3", "∠ 142.5°"), and an appearance.

## Captions in the appearance

- The Render worker's own pipeline draws the caption: HarfBuzz shaping in Inter, with Noto Sans Math
  for "∠". The fonts are embedded as Type0 subsets (the comment-font pipeline of D-52). PDFium's
  own appearance (for colour, width, dashes and line endings) or our own drawing (fills, arcs,
  symbols) is wrapped around it, the same way as M13-10's leader lines.
- **Fonts:** 40 of the 42 markups use only embedded fonts (the other two are the v1.1.0 pair,
  which the pack keeps as 1.1.0 wrote it). No standard 14 font is used, and no system font.
- **Above or In line:** `/CP /Top` puts the caption on the reading side of the dimension line.
  `/CP /Inline` cuts a gap into the line (an even-odd clip), so the caption never sits on the line.
  Captions turn to read left to right or bottom to top.
- **Holes:** a Cutout or Volume fills its outline and its holes with one even-odd path. Holes stay
  white, and each hole has a dashed outline (unit test: a pixel at a hole's centre is white, the slab around it is tinted).
- **Size:** each caption embeds a font subset of **1.5–3 kB** per markup, so the 42 markups make a 196 kB pack.
  That is fine for lengths and areas. It is too much for counts: 1,000 counts would add about
  1.7 MB. **Recommendation for M14-03 and M14-07:** share one font object per face across a
  document's measurements. The Ctrl+S that adds glyphs rewrites that one object with the union
  subset (incremental, rule 7), and every appearance keeps pointing at it.

## The Triya data in `/PieceInfo`

```
page /PieceInfo << /TriyaPDF << /LastModified (D:…)
                                /Private << /Type /TriyaMeasurements /V 1
                                            /Items << /<NM> << /T /Volume /Lb (Slab S1) /Dp 250 /H [[…] […]] /F (…) >> … >> >> >> >>
page /LastModified (D:…)
```

Keys: `T` tool, `Lb` label, `G` `No` `Sh` count group, number and shape, `Dp` depth, `U` `Dc` unit
and decimals, `H` holes, `Arc << C R A By >>` arc, `Sc` scale (for the subtypes without
`/Measure`), and `F`, a fingerprint of the geometry (FNV-1a of the points or `/Rect`, rounded to 0.01 pt).

- Staged through the object layer (`stagePatch` on the page), so it rides the single Ctrl+S
  revision. `PAGE_KEYS` now admits `PieceInfo` and `LastModified`.
- **Survives a later Ctrl+S:** reopening the pack, adding a comment on every page and saving
  again keeps all 40 entries. That revision is 8.9 kB.
- **Read back** (`triyaData.ts`, `readBack`):
  - _Full_ (the fingerprint matches): everything is restored (40 of 40).
  - _Moved elsewhere_ (another editor moved or reshaped the markup, so the fingerprint differs): tool,
    label, count group, number, shape and depth are kept; the shape-bound data, holes and arc, is
    dropped. The markup reads back as well as its geometry allows. A moved Volume, for example, is still a Volume
    with its depth and label, but without holes.
  - _No data_ (`/PieceInfo` removed by another program): the standard kinds come back from `/IT`
    and the geometry (LineDimension → Length; PolyLineDimension → Perimeter when closed, else
    Polylength; PolygonDimension → Area, so a Volume or Cutout reads as an Area). The other kinds
    stay plain markups that still show and print as drawn.

## Redrawn by a viewer

Some editors throw away an annotation's appearance and redraw it from its dictionary, for example when it is moved.
PDFium's generator (`EPDFAnnot_GenerateAppearance`) stands in for such an editor here. The
pictures are `redraw-p<N>-{before,after}.png` in the task folder.

- **Line, PolyLine, Polygon:** the geometry stays, but the caption, the fill, the holes and the leader
  lines are lost, because PDFium ignores `/Cap`, `/LL` and our holes. The value is still in `/Contents`, and the
  comment list shows it. Whether Acrobat Reader or the second desktop editor redraws these on a move is the
  main question of the owner's check. Acrobat is known to draw a Line's `/Cap` text from `/Contents`.
- **Circle and Square:** PDFium ignores `/RD` and draws the shape across the whole `/Rect`.
  A Radius circle swells to cover its caption, and a Count square becomes a box around the symbol and
  its number (ink after redraw 126–170 %). A partial arc becomes a full circle.
- **Stamp:** a Stamp has no geometry to redraw from, so its appearance is kept exactly (ink
  100 %). This is why Angle, Radius, Diameter and Count are proposed as Stamps. The cost is
  that a viewer cannot edit their points, and without the Triya data they read back as plain stamps.
  Their value is still in `/Contents` and `/Subj` names the tool.
- **FreeText (summary):** redrawn as plain text lines from `/Contents`, which can still be read.

## Viewers checked here

- **Chromium's own PDF viewer** (headless Playwright, `viewer-shots.ts`): every caption, the
  In line gap, the hole cut-outs, the leader lines, the count symbols, and the summary table look as
  drawn. Chromium's viewer does not let anyone select or move these annotations, so for Chrome and Edge the
  check is "looks right, value readable".
- **PDFium** (the app's engine): as above. Redraw results are listed above.
- **Poppler** (`pdftoppm`): the same picture as Chromium. It prints one warning, "Can't get Fields array": PDFium
  writes an `/AcroForm` with `/DA` and `/DR` but no `/Fields` when a FreeText is created. This is not
  new to measurements; M14-10's summary table can add an empty `/Fields` array when it writes one.
- **qpdf --check:** no errors in the pack or in any corpus sheet.

## The pack

`npm run spike:s34` builds
`Synthetic PDF Corpus/measure/interop/S34_interop_pack.pdf` from corpus sheets 01, 02 and 03 on the app's own
engine (PDFium, EmbedPDF, SaveTracker), then checks it with the Work worker's object reader. Its
three pages:

1. **Floor plan, 1:100.** Length with an offset (Above). Length In line (the diagonal).
   Polylength. Perimeter "Office". Area "Workshop". Volume "Slab S1" (250 mm deep, two holes).
   Seven Count "Door" stamps. The summary table.
2. **Pipe run, 1:50.** Polylength "Line 150-P-101". Two Angles (142.5°, 37.5°). Radius on the
   bend, by three points. Diameter of the tank. Radius of the flange. Ten Counts in five symbols.
3. **Three scales.** Lengths at 1:50, 1:5 and 1:10. Cutout "End plate" with four bolt holes.
   **The alternatives:** Angle as a PolyLine, Count as Squares, Radius as a Circle and as a
   PolyLine, Diameter as a Circle. **A v1.1.0 Distance** (Line and grouped FreeText) for the
   update bar.

Every value matches the corpus manifest: 24,000; 10,817; 23,000; 30,000 mm; 114.00 m²; 17.69 m³;
15,000 mm; 142.5°; 37.5°; R 1,200; Ø 3,000; 8,000; 400; 900 mm; 0.0985 m².

## Running it

```sh
npm run corpus:measure            # write the measure corpus (--check: verify it is current)
npm run spike:s34                 # build and check the pack → test-results/s34-node.json
npm run spike:s34 -- --pictures <dir>   # also the PDFium redraw pictures
node --import ./spikes/shared/ts-ext.ts spikes/s34-measure-markups/viewer-shots.ts <dir>   # Chromium viewer pictures
npx vitest run spikes/s34-measure-markups   # the findings as tests (19)
```
