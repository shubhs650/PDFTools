# Spike S29 — the overlay on screen and the vector overlay PDF (M12-04)

Task M12-04 of [docs/plan/M12.md](../../docs/plan/M12.md) (D-59; ADR-031). Input for **ADR-032
(M12 spike results)**, which task M12-06 writes for the owner's acceptance. No feature code:
everything here is in `spikes/s29-overlay/`.

**Verdict: works with workaround.**

- **On screen: combine in a worker** (not in the browser's compositor). Direct PDFium calls render
  each revision through a matrix, without comments, straight to an 8-bit grey bitmap; a worker
  tints and multiplies with lookup tables and hands one bitmap per tile to the page. Overlap is
  exactly black, Fade unchanged and Thicken thin lines work, and zooming keeps every frame on
  time. The compositor route gives the same colours but drops frames while zooming, needs twice
  the bitmap memory, and cannot do Fade, Thicken or a clean grey overlap at all.
- **Vector overlay PDF: route 2 (recolour), with route 1's mask for everything that is not a
  plain colour** (images, inline images, shadings, pattern fills, spot and other special colour
  spaces). It displays correctly in PDFium (this app), Poppler and pdf.js on all eight pairs and
  the stress sheet, is smaller than the two sources together, and draws at 6400 % about as fast
  as the screen route. **Route 1 (wrap and tint) alone, the plan's first choice, is not
  enough:** PDFium, the app's own engine, ignores layer visibility inside a soft mask, so a
  layer that the old file hides shows up in green (pair 11). Route 1 stays in the spike as the
  reference. **The image fallback is not needed.**
- **Owner's check still open:** Acrobat Reader, a second desktop PDF editor and the built-in
  viewers of Chrome, Edge and Firefox, with the sample pack (below). Chrome's and Edge's built-in
  viewer is PDFium and Firefox's is pdf.js, both already checked here as engines, so the open
  question is mainly the desktop editors.

## How it was tested

- **PDFium directly** (`pdfiumKit.ts`, `@embedpdf/pdfium` 2.15.1, the app's pinned engine):
  `FPDF_RenderPageBitmapWithMatrix` into an `FPDFBitmap_Gray` bitmap, without the `FPDF_ANNOT`
  flag, through a matrix made of the zoom, the tile offset and the A → B transform in display
  space (`sheet.ts`: `/Rotate` and crop box, unit-tested).
- **Composition** (`composite.ts`, unit-tested): three 256 × 256 lookup tables built once per
  style (colours, show/hide, balance, Fade unchanged, overlap mode), so composing a tile is one
  table read per pixel. Thicken is a 3 × 3 minimum filter on the grey tile, rendered with a
  one-pixel margin so tiles join without seams.
- **Browser** (`main.ts`, `overlay.worker.ts`, `s29.spec.ts`): one sheet in a scrolling view, 512
  px tiles, centre first, in a worker that owns PDFium; older requests are dropped when the view
  moves on. Two routes side by side:
  - **worker:** the worker composes, the page places one `ImageBitmap` per tile
    (`bitmaprenderer` canvas);
  - **compositor:** the worker sends the two grey tiles; each side is a CSS isolation group (its
    colour as background, the grey tile with `mix-blend-mode: screen` = tint), side B multiplied
    over side A (`mix-blend-mode: multiply`).
- **Vector overlay builder** (`vectorOverlay.ts`, `content.ts`): imports the source pages with
  PDFium (`FPDF_NewXObjectFromPage`, which also opens encrypted files), then adds the overlay
  with the app's own object layer (`src/model/pdf`) as an incremental section and saves once more
  with PDFium to compact. Both routes on corpus pairs 01, 07, 08, 11 (layers), 12 (password
  `test1234`), 14 (dense A1, 85,000 segments), 15 (A1 against A3, aligned by the manifest
  transform), 16 (identical control) and a **self-made stress sheet** (`make-fixtures.ts`,
  rule 13): an RGB image, an image mask, an inline image, a shading painted with `sh` inside a
  clip, a shading pattern fill, a spot (Separation) colour, ICC and CMYK colours, a nested form,
  stroked text, zero-width hairlines, a white knock-out fill and 50 % transparency.
- **Correct display** is measured, not eyeballed: each page of each overlay PDF is rendered at
  1.5 px/pt by **PDFium**, **Poppler** (`pdftoppm`, an external program, not bundled) and
  **pdf.js 4.10.38** in Chromium (installed outside the repository for the run only, never
  bundled), and compared with the screen route's composition of the same two pages (the
  reference): mean difference per channel, share of pixels off by more than 96, and the red,
  green and black pixel counts.
- **Drawing speed at 6400 %**: one 512 px tile at 64 × 96/72 px/pt from the middle of the sheet
  in each engine, against the same tile of Document B alone ("normal view").

```sh
npx vitest run spikes/s29-overlay                                       # composition, matrices
node spikes/s29-overlay/make-fixtures.ts                                # stress sheets, corpus copies
PDFJS_DIR=/path/to/pdfjs PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium \
  node --import ./spikes/shared/ts-ext.ts spikes/s29-overlay/run-node.ts   # → test-results/s29-node.json, out/pack/
SPIKE=s29 PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run spikes -- --project=s29
                                                                        # → test-results/s29-browser.json
```

`PDFJS_DIR` is a folder with `node_modules/pdfjs-dist` (`npm install pdfjs-dist@4.10.38` there);
without it, and without `pdftoppm`, the script skips those engines.

## Results: the overlay on screen

| Question (plan)                    | Result                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering without comments         | **Yes.** Pair 19 Rev A has 10 comments; rendered with and without `FPDF_ANNOT`, 7,405 pixels differ, all of them comments. Without the flag none is drawn.                                                                                                                              |
| Rendering through a matrix         | **Yes.** Pair 15 (A1 against its A3 copy, scale 0.4994): coloured ink falls from **88.1 %** of all ink unaligned to **47.8 %** with the manifest transform in the matrix. What remains is real: the A3 plot's pens are twice as heavy relative to the sheet, and a 0.5 pt offset (S28). |
| Exact black on overlap             | **Yes.** Identical pair 16 at 2 px/pt: all 118,268 full-ink pixels are exactly 0, 0, 0; not one red or green pixel, in both overlap modes. In the browser, both routes: 0 red, 0 green.                                                                                                 |
| Worker against compositor: colours | **The same.** Pair 01 at 100 %: red 5,111 / 5,111, green 9,245 / 9,246, black 6,779 / 6,779 pixels.                                                                                                                                                                                     |
| Worker against compositor: zooming | **Worker.** Below: every frame on time with the worker; the compositor runs at half the frame rate or less, with 10–16 frames over 25 ms.                                                                                                                                               |
| Memory                             | **Worker: half the bitmaps.** Below.                                                                                                                                                                                                                                                    |
| Fade unchanged                     | **Worker only.** A lookup-table change (re-compose from cached grey tiles, 40–47 ms for a screen). CSS blending has no "lighten only where both have ink".                                                                                                                              |
| Thicken thin lines                 | **Worker only.** Pair 14 at 100 %: lines 1–2 px wide become 3–4 px (`out/p14-100-*.png`). It costs a re-render with a margin: 57–103 ms per dense 512 px tile, 10–33 ms on a light one.                                                                                                 |
| Grey overlap without olive edges   | **Worker only** ("neutral" overlap mode, below).                                                                                                                                                                                                                                        |
| Main thread                        | **No pixel work** in either route; 0 long tasks in every run.                                                                                                                                                                                                                           |

### Zooming (headless Chromium, 1600 × 1000, software compositing)

Sharp after a jump from 25 % (every visible tile on screen), then a zoom gesture 100 % → 800 %
in 12 steps 80 ms apart, rendering as it goes. Each route starts with no cached tiles. Two runs.

| Sheet              | Route      | Sharp after jump to 100 / 400 / 1600 / 6400 % | Gesture frames | p95        | Over 25 ms  | Long tasks / long animation frames | Bitmaps on screen |
| ------------------ | ---------- | --------------------------------------------- | -------------- | ---------- | ----------- | ---------------------------------- | ----------------- |
| Pair 14 (dense A1) | worker     | 623–678 / 779–816 / 896–966 / 663–729 ms      | 96–104         | 16.7 ms    | 0           | 0 / 0                              | 12.6 MB           |
|                    | compositor | 679–960 / 928–965 / 819–897 / 609–667 ms      | 47–55          | 34–50 ms   | 10–13       | 0 / 0–6                            | 25.2 MB           |
| Pair 01 (flange)   | worker     | 65–76 / 113–128 / 90–113 / 91–112 ms          | 60–63          | 16.7 ms    | 1–2 (33 ms) | 0 / 0                              | 15.7 MB           |
|                    | compositor | 111–159 / 140–188 / 131–177 / 145–179 ms      | 18–19          | 100–117 ms | 16          | 0 / 8–9                            | 31.5 MB           |

The compositor route is slower because it must blend two full layers of canvases (24–30 of them)
on every frame; the worker route has one canvas per tile and no blending at all. Headless
Chromium composites in software, so a GPU will narrow the gap, but not the memory or the missing
features.

JS + WASM heaps (`measureUserAgentSpecificMemory`): 82–91 MB on pair 14, 128–146 MB on pair 01.
The difference is the worker's grey-tile cache, which this spike never trims (89–179 tiles, up
to 90 MB after the gesture). The real view needs a cap (risk 2).

### Cost of one 512 px tile in the worker (Node, median ms, two runs)

| Sheet   | Zoom      | Grey A  | Grey B  | Normal view (B, colour) | Compose (Multiply) | Compose (neutral) | New style tables | Thicken (re-render + filter + compose) |
| ------- | --------- | ------- | ------- | ----------------------- | ------------------ | ----------------- | ---------------- | -------------------------------------- |
| Pair 14 | 25 %      | 39–41   | 38–40   | 40–42                   | 2.7–2.9            | 1.6–1.7           | 1.6              | 95–103                                 |
|         | 100 %     | 39–48   | 38–47   | 39–48                   | 4.1–4.8            | 2.5–3.1           | 2.0–2.4          | 68–87                                  |
|         | 400 %     | 27–38   | 27–38   | 28–40                   | 2.7–4.4            | 1.6–2.6           | 1.5–2.2          | 62–92                                  |
|         | 1600 %    | 24–41   | 26–38   | 27–39                   | 2.7–4.5            | 1.6–2.8           | 1.5–2.3          | 62–94                                  |
|         | 6400 %    | 25–35   | 25–33   | 25–38                   | 2.7–4.2            | 1.6–2.5           | 1.6–2.2          | 57–66                                  |
| Pair 01 | 25–6400 % | 0.9–4.4 | 0.9–4.7 | 1.3–6.6                 | 1.8–6.8            | 0.8–4.1           | 1.6–3.3          | 10–33                                  |

An overlay tile costs two grey renders plus 2–5 ms: about twice the normal view of one revision.
Grey renders cost the same as colour ones.

### Style changes (browser, until the screen shows the new style)

| Change                        | Worker             | Compositor       |
| ----------------------------- | ------------------ | ---------------- |
| Colour preset (red/blue)      | 64–72 ms           | 55–65 ms         |
| Balance                       | 47–49 ms           | 49–62 ms         |
| Hide old / show old           | 54–64 / 36–47 ms   | 29–50 / 49–71 ms |
| Fade unchanged                | 40–47 ms           | —                |
| Neutral overlap               | 62–63 ms           | —                |
| Thicken on / off (re-renders) | 166–197 / 80–94 ms | —                |

## Results: the vector overlay PDF

### Correct display

Largest colour difference against the reference over all pages, in ‰ of the reference's
coloured pixels (red + green), and the worst mean difference per channel (0–255):

| Pair             | PDFium route 1 | PDFium route 2 | Poppler 1 / 2       | pdf.js 1 / 2        | Note                                                                                                       |
| ---------------- | -------------- | -------------- | ------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| 01 flange        | 2 ‰ (0.68)     | 3 ‰ (0.67)     | 22 / 22 ‰ (1.8)     | 9 / 7 ‰ (1.2)       | Poppler draws thin coloured lines lighter (anti-aliasing)                                                  |
| 07 two sheets    | 2 ‰ (0.55)     | 3 ‰ (0.33)     | 3 / 3 ‰ (1.1)       | 3 / 3 ‰ (1.1 / 0.6) |                                                                                                            |
| 08 three sheets  | 0 ‰ (3.2)      | 0 ‰ (3.0)      | 0 / 0 ‰ (11.8)      | 0 / 0 ‰ (4.2)       | page 2's micro-text draws heavier in Poppler and pdf.js, the same for both routes and for the source alone |
| **11 layers**    | **113 ‰**      | 7 ‰ (0.80)     | 10 / 10 ‰ (1.6)     | 2 / 3 ‰ (1.1)       | **route 1 in PDFium shows the old file's hidden layer**                                                    |
| 12 password      | 3 ‰ (0.75)     | 3 ‰ (0.71)     | 6 / 6 ‰ (1.2)       | 5 / 5 ‰ (1.0)       | encrypted source, imported with its password                                                               |
| 14 dense A1      | 0 ‰ (0.03)     | 0 ‰ (0.04)     | 1 / 1 ‰ (7.5)       | 0 / 0 ‰ (2.3)       | Poppler draws zero-width hairlines heavier                                                                 |
| 15 A1 against A3 | 10 ‰ (0.31)    | 11 ‰ (0.31)    | 51 / 51 ‰ (2.0)     | 44 / 43 ‰ (0.9)     | aligned (manifest transform); differences at edges only                                                    |
| 16 identical     | 0 (0.78)       | 0 (0.76)       | 0 / 0 (2.0)         | 0 / 0 (1.3)         | not one red or green pixel in any engine                                                                   |
| stress sheet     | 0 ‰ (0.14)     | 0 ‰ (0.38)     | 3 / 3 ‰ (1.4 / 1.5) | 1 / 0 ‰ (0.9 / 1.0) | images, masks, shadings, patterns, spot colour all tinted                                                  |

Everything below 1 mean difference and a few ‰ is anti-aliasing; the pages look the same. Every
difference other than route 1's layers is the engine's own way of drawing the sources (the same
for both routes, and for the source pages alone).

The rendered pages are in `out/render-{pdfium,pdfjs}-*.png` after a run.

### File size and build time

| Pair           | Pages | Sources (A + B) | Route 1   | Route 2   | Build route 1 | Build route 2 |
| -------------- | ----- | --------------- | --------- | --------- | ------------- | ------------- |
| 01             | 1     | 13,301 B        | 11,664 B  | 10,277 B  | 33–55 ms      | 40–45 ms      |
| 07             | 2     | 11,217 B        | 12,437 B  | 9,710 B   | 28–33 ms      | 32–45 ms      |
| 08             | 3     | 19,334 B        | 21,264 B  | 17,332 B  | 26–41 ms      | 47–67 ms      |
| 11 (18 layers) | 2     | 12,841 B        | 15,672 B  | 12,987 B  | 28–41 ms      | 26–40 ms      |
| 12 (encrypted) | 2     | 10,885 B        | 11,625 B  | 8,989 B   | 20–41 ms      | 22–28 ms      |
| 14 (dense A1)  | 1     | 566,718 B       | 565,536 B | 564,132 B | 220–341 ms    | 784–785 ms    |
| 15             | 1     | 15,714 B        | 16,687 B  | 15,259 B  | 20–21 ms      | 34–37 ms      |
| 16             | 2     | 24,238 B        | 28,556 B  | 25,773 B  | 34–40 ms      | 35–53 ms      |
| stress         | 1     | 9,222 B         | 9,891 B   | 15,440 B  | 8–15 ms       | 17–24 ms      |

Two runs; sizes are the same in both.

Both routes stay at about the size of the two sources: the drawing is kept once per side, the
overlay adds a few hundred bytes per page, and the PDFium save at the end drops what the
incremental section replaced. Route 2's copy of the drawing compresses as well as the original.
The stress sheet is the exception (route 2: +6 KB): its one-object masks are small forms each.
Route 2 on pair 14 spends 600 ms tokenizing 85,000 segments in JavaScript; in the Work worker
that is a progress-reported, cancellable job (rule 2), well under a second per heavy sheet.

### Drawing speed at 6400 % (one 512 px tile, ms, two runs)

| Sheet  | Engine   | Route 1   | Route 2   | Screen route (two grey renders + compose) | Normal view of B |
| ------ | -------- | --------- | --------- | ----------------------------------------- | ---------------- |
| 01     | PDFium   | 7.1–12.5  | 3.3–4.8   | 4.9–8.4                                   | 1.4–2.3          |
| 14     | PDFium   | 59–65     | 57–79     | 53–65                                     | 25–27            |
| stress | PDFium   | 10.2–11.1 | 13.0–15.6 | 3.9–6.5                                   | 0.7–3.8          |
| 01     | Poppler¹ | 93–106    | 60–70     | —                                         | 50–57            |
| 14     | Poppler¹ | 224–255   | 184–232   | —                                         | 105–143          |
| stress | Poppler¹ | 69–70     | 138–205   | —                                         | 33–44            |
| 01     | pdf.js   | 74–81     | 61–68     | —                                         | 42–57            |
| 14     | pdf.js   | 192–200   | 165–211   | —                                         | 89–125           |
| stress | pdf.js   | 929–1074  | 960–1083  | —                                         | 530–611²         |

¹ Includes starting `pdftoppm`. ² pdf.js is slow on the stress sheet's shadings and images even
for the source page alone.

The vector overlay draws in about twice the time of one revision, in every engine: the cost of
drawing two pages. It is as fast as the screen route in PDFium, so the "Vector overlay (beta)"
display mode needs no extra worker. There is no route-specific slowdown at deep zoom.

## Findings

1. **PDFium ignores layer visibility inside a soft mask** (route 1). A page form that holds
   optional content draws every layer when it is used as a mask's backdrop, so route 1 shows a
   layer that the file hides by default (pair 11: 17,107 green pixels expected, 5,377 drawn, the
   rest buried under the hidden layer). Poppler and pdf.js honour the layer. Route 2 keeps the
   source's `BDC … EMC` marks around every object it masks, so it is right in all three. Since
   PDFium is the app's own engine (and Chrome's and Edge's viewer), route 1 alone cannot be used.
2. **pdf.js ignores a blend mode set in the same graphics state as a soft mask.** The tinted
   fill is therefore drawn inside its own isolated transparency group, and the Multiply is
   applied when that group is painted. All three engines then agree.
3. **Poppler draws green fringes on unchanged lines** when only side B is a transparency group.
   Both sides are painted as isolated groups; the fringes are gone (pair 16: 0 green pixels).
4. **Route 2 needs route 1's mask for anything that is not a plain colour.** Rewriting colour
   operators gets plain DeviceGray/RGB/CMYK and ICC fills and strokes right (luminance kept:
   L = 0.3 R + 0.59 G + 0.11 B, painted as the tint at that strength). Images, image masks,
   inline images, shadings (`sh`), pattern fills and paints in Separation, DeviceN, Indexed and
   Pattern spaces are instead drawn into a one-object luminosity mask that replays the current
   matrix, the stroke state and the colour, and the tint is painted through it in place, inside
   the page's current clip and marked content. On the
   stress sheet this brought the mean difference from 1.66 to 0.38. The initial colour of every
   top-level form is set to the full tint, so text that never sets a colour is tinted too.
5. **Layers in the overlay.** The overlay keeps each source's optional content groups and merges
   them into one `/OCProperties`, with each file's own default visibility, under "Old — file" and
   "New — file" in the reader's layer panel (pair 11: 18 layers).
6. **Encrypted sources** (pair 12) import through PDFium with their password; the overlay file
   itself is not encrypted. Permissions of the sources are honoured by the comparison feature
   before the builder runs (rule 9), not by the builder.
7. **Neutral overlap** (worker only). With plain Multiply, the anti-aliased edge of a line that
   is in both revisions mixes the two colours to olive (128, 128, 64 for half-ink red over
   half-ink green). Drawing shared ink as neutral grey, `min(a, b)`, and only the excess in the
   tint, removes the olive edges and is cheaper (1.6 against 2.7 ms a tile). It is offered as the
   way the overlap is drawn, not as a blend-mode list (D-59: only Multiply is offered to the user;
   for full ink both modes give the same exact black).
8. **Thicken merges lines closer than its reach.** Lines 1–2 px wide become 3–4 px; lines less
   than 2 px apart (hatching, small text) merge into a band. That is what the switch is for, but
   it should say so in its tooltip.

## What the overlay view and the builder must do (M12-11, M12-16)

1. **Render worker → overlay worker.** The overlay window gets its own worker with its own PDFium
   instance holding Documents A and B (read only), as here. The page asks for tiles by key
   (zoom, column, row), centre first, and drops the requests of a zoom it has left (a generation
   number checked before rendering, a queue served one per task so a cancel overtakes stale
   requests).
2. **Grey tiles are cached; colours are not.** Style changes (colours, presets, show/hide,
   balance, Fade, neutral) re-compose from the cached grey tiles (40–70 ms a screen); only
   Thicken and the zoom re-render. The cache needs a byte cap and least-recently-used eviction
   (§12), and is released when the comparison closes.
3. **Matrices in display space** (`sheet.ts`): the A → B transform from M12-10 goes into the
   render matrix of A; B is rendered as is. Comments are left out by not passing `FPDF_ANNOT`;
   comments of A and B are drawn on top by the normal annotation layer (S27's note on the
   overlay window as a live document).
4. **The vector overlay builder** in the Work worker, in this order: import pages with PDFium
   (handles encryption), write the overlay with the object layer as one incremental section,
   save once with PDFium to compact. Route 2 with per-object masks as in `vectorOverlay.ts`;
   memoise recoloured forms per source form and side; both sides as isolated groups, B
   multiplied; full tint as the initial colour of each top-level form; layers merged with their
   defaults.
5. **Unit tests to keep** from this spike: the composition tables, Thicken across tile seams,
   the dark-overlap check, the display-space matrices, the tokenizer (inline images, strings,
   ASCII85), and the stress sheet as a fixture for the builder's e2e.

## Risks

1. **Route 2 rewrites content.** Anything the tokenizer or the colour model does not know is
   drawn wrongly, not lost: unknown colour spaces fall back to the mask, which is always right.
   Not covered here: Type 3 fonts whose glyphs set their own colour (`d0`), source soft masks and
   blend modes inside the drawing, and text render mode 7 (clip). Mitigation: the builder can fall
   back to route 1's whole-page mask for a page that holds any of these and no optional content;
   for a page with both, M12-16 decides with a fixture.
2. **The grey-tile cache grows without a cap here** (up to 90 MB after one zoom gesture on a
   light sheet). Mitigation: change 2 above.
3. **Thicken re-renders**, about 60–100 ms a dense tile, so a dense screen takes about a second
   to thicken. Acceptable for a switch, not for a slider.
4. **Not covered here** and left to the owner's check and M12-16's e2e: Acrobat Reader, a second
   desktop PDF editor, and the real Chrome, Edge and Firefox viewers (the engines are covered);
   printing the overlay; a GPU compositor (the numbers are headless Chromium in a 4-core
   container).

## The owner's check (sample pack)

`out/pack/` after a run, and attached to the M12-04 thread: for each pair, `overlay_<pair>_route1-wrap.pdf`
and `overlay_<pair>_route2-recolour.pdf`. Open each in Acrobat Reader, a second desktop PDF editor
and the built-in viewers of Chrome, Edge and Firefox, and check:

1. Old-only ink is red, new-only ink is green, ink in both is **black**; paper is white.
2. Pair 16 (identical): no red or green anywhere.
3. Pair 11: the layer panel lists the layers under "Old — …" and "New — …"; nothing that the old
   file hides by default shows up (**route 1 is expected to fail this in Chrome and Edge**).
4. The stress sheet: the photo ramp, the ring, the small grey square, the shaded rectangle, the
   pattern-filled rectangle, the spot-colour line and the outlined "Rev A/B outline" text are all
   in red, green or black, never in their own colours.
5. Zoom to 6400 % on pair 14: the page draws in a reasonable time (a second or two at most).
