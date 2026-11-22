# Spike S28 — alignment, pairing and detection (M12-03)

Task M12-03 of [docs/plan/M12.md](../../docs/plan/M12.md) (D-60, D-61, D-66; ADR-031). Input for
**ADR-032 (M12 spike results)**, which task M12-06 writes for the owner's acceptance. No feature
code: everything here is in `spikes/s28-alignment/`.

**Verdict: works, route 1 (our own code).** Our own aligner (vector geometry for drawings, a
small image method for scans) meets every alignment target of the plan on every corpus case,
is more accurate than OpenCV ORB on every case, about 5 × faster, and adds **7.6 KB** gzip to
the install against **3.5 MB** for OpenCV.js. OpenCV is not needed. Page pairing (ink and text
signatures plus an order-keeping assignment) pairs all 19 overlay pairs correctly. Difference
detection at **150 dpi** finds **every true difference (240 of 240)** on the vector corpus with
one false report on 39 sheets, and the three changes of the scanned pair with a scan setting.
Nothing in the plan has to change; the numbers for the acceptance table are below.

## How it was tested

- **Node harness** (`run-node.ts`) on PDFium WASM, the same build the Work worker uses. Pages are
  rendered as an ink raster (255 − darkest channel, comments not drawn) straight through a
  placement matrix (`FPDF_RenderPageBitmapWithMatrix`, in bands); vector geometry comes from the
  app's own `extractGeometry` (`src/workers/work/geometry.ts`), positioned text from FPDFText.
  Everything is in **displayed-page space** (pt, y down, /Rotate and CropBox applied).
- **Corpus:** the 19 overlay pairs of `Synthetic PDF Corpus/`, including the M12-01 pairs 14
  (dense A1, about 74,000 feature points) to 19. Five **moved copies** made by transforming
  every page object of a B sheet in place (`cases.ts`), and four **simulated scans** (rendered,
  skewed, scaled, with noise) on top of the real scanned pair 06.
- **Ground truth, independent of the detection it checks** (`truth.ts`):
  - **Alignment:** every generated sheet draws its content under one `cm`; the true transform
    is B's matrix after A's inverse, between the displayed pages. For the moved copies the
    applied matrix is the truth. Pair 06 (a real scan pair) has no recorded transform: it is
    checked by the residual after alignment.
  - **Differences:** A's line geometry and positioned characters, moved by the true transform,
    against B's. A stretch of line farther than 0.75 pt from every line of the other revision,
    or a character not found at its place, is a difference; differences closer than 8 pt form
    one item. Only what each side shows counts (white fills, clipped hatching, hidden layers and
    invisible text are taken out by checking each side's own rendering).
- **Route 2** used `@techstark/opencv-js@4.12.0-release.1` (Apache-2.0), installed with
  `--no-save` for the run only: ORB with 8,000 features, brute-force Hamming matching with a
  0.8 ratio test, then **our own** similarity RANSAC (this build has no
  `estimateAffinePartial2D`, and `estimateAffine2D` allows uneven stretch, which the plan rules
  out). Rendered at 100 and 150 dpi.
- Times are one Node process on the cloud container (one core), not the reference machine; they
  vary by about 15 % between runs (errors do not). All
  numbers below are from the last full run; raw results go to `out/s28-*.json`.

```sh
npm install --no-save @techstark/opencv-js@4.12.0-release.1   # route 2 only
node --import ./spikes/shared/ts-ext.ts spikes/s28-alignment/run-node.ts            # all sections
node --import ./spikes/shared/ts-ext.ts spikes/s28-alignment/run-node.ts align asis # some
npx vitest run spikes/s28-alignment                                                 # 11 unit tests
```

## Route 1: our own aligner

1. **Coarse** (any page): Fourier–Mellin on a 512 × 512 low-resolution ink raster: Hann window,
   high-pass, log-polar magnitude, phase correlation for rotation and scale (searched within
   ±10° and 0.25 to 4 ×, with θ and θ + 180° tried), then phase correlation for the shift. About
   0.3 to 0.4 s, within about 1 pt.
2. **Vector refine** (pages with geometry): feature points from the page's own line work (line
   ends, corners, junctions), spread over the page (at most 4 per cell of a 64-cell grid), then a
   two-point similarity RANSAC over the three nearest candidates and closest-point least squares
   with the search radius halving down to 0.5 pt.
3. **Scan refine** (pages without usable geometry): phase correlation of up to 120 tiles of
   128 px at 0.5, 1 and 2 px/pt (sampled from an image pyramid, one tile at a time), then RANSAC
   over the tile shifts.

## Results: alignment

Error = largest corner displacement over the sheet between the found and the true transform.
The targets (plan: shift ≤ 0.5 pt, scale ≤ 0.05 %, rotation ≤ 0.05°) hold for every row of
both routes; "max error" is the strictest single number.

| Case                                               | Route 1 max error | Route 1 time | Route 2 (ORB, 150 dpi) max error | Route 2 time |
| -------------------------------------------------- | ----------------- | ------------ | -------------------------------- | ------------ |
| 03 P1, shift +14 / −9 pt                           | 0 pt              | 344 ms       | 0.170 pt                         | 2,163 ms     |
| 03 P2, 98.2 % scale                                | 0 pt              | 379 ms       | 0.136 pt                         | 2,438 ms     |
| 03 P3, already aligned                             | 0.003 pt          | 391 ms       | 0.001 pt                         | 2,217 ms     |
| 04 P1, 1.2° skew                                   | 0 pt              | 319 ms       | 0.091 pt                         | 2,217 ms     |
| 04 P2, /Rotate 90                                  | 0 pt              | 310 ms       | 0.002 pt                         | 1,707 ms     |
| 09 P1, page boxes                                  | 0 pt              | 314 ms       | 0.001 pt                         | 2,136 ms     |
| 13 P1, ARCH D                                      | 0 pt              | 374 ms       | 0.001 pt                         | 5,226 ms     |
| 13 P2, ARCH E                                      | 0 pt              | 345 ms       | 0.002 pt                         | 7,352 ms     |
| 14, dense A1                                       | 0 pt              | 1,302 ms     | 0 pt                             | 4,260 ms     |
| 15, A1 against its A3 copy (49.94 %)               | 0 pt              | 364 ms       | 0.247 pt                         | 3,060 ms     |
| 14 moved: 96 %, 0.6°, 40 / −25 pt                  | 0 pt              | 1,721 ms     | 0.069 pt                         | 5,914 ms     |
| 14 moved: 2.5°, −60 / 35 pt                        | 0 pt              | 1,527 ms     | 0.064 pt                         | 5,556 ms     |
| 08 moved: 103 %, 0.8° (hairlines)                  | 0 pt              | 418 ms       | 0.074 pt                         | 2,100 ms     |
| 13 P2 moved: 98.5 %, −0.4°                         | 0 pt              | 318 ms       | 0.139 pt                         | 7,039 ms     |
| 02 moved: 3°                                       | 0 pt              | 366 ms       | 0.206 pt                         | 2,186 ms     |
| **Scans** (error in pt; 1 px at 150 dpi = 0.48 pt) |                   |              |                                  |              |
| 06, real pair: 150 / 200 dpi, 0.5° skew            | residual 0.2 px¹  | 1,494 ms     | residual 0.26 px¹                | 2,137 ms     |
| 02 simulated scan, 0.5° skew                       | 0.029 pt          | 1,697 ms     | 0.221 pt                         | 2,227 ms     |
| 08 simulated scan, 101.2 %, −0.8°                  | 0.054 pt          | 1,265 ms     | 0.241 pt                         | 2,427 ms     |
| 14 simulated scan, dense A1, 0.35°                 | 0.047 pt          | 2,910 ms     | 0.489 pt (42 inliers)            | 5,392 ms     |
| 03 P2 simulated scan, 98.2 % and 1.1°              | 0.121 pt          | 1,605 ms     | 0.216 pt                         | 2,409 ms     |

¹ Pair 06 has no recorded transform. Route 1 finds 0.503°, 100.01 %, shift 3.71 / −5.08 pt (the
manifest says 0.5° skew); after alignment the median distance from an ink pixel of A to the
nearest of B is 0 px and the mean 0.2 px at 150 dpi, the same as the simulated scans whose
truth is known. **Scans: within 0.25 px at 150 dpi** (target: 2 px).

Time per vector sheet is mostly the coarse step (0.3 to 0.4 s); the refine takes 2 to 50 ms,
and 0.5 to 0.9 s on the dense A1 sheet (74,000 points). The coarse step is skipped when the "as
is" check passes (below), which is the usual case for revisions of one drawing.

### Install size and licence

| Route                            | Minified | Gzip       | Licence    | Start-up |
| -------------------------------- | -------- | ---------- | ---------- | -------- |
| 1: own code (align, pairing)     | 18 KB    | **7.6 KB** | ours       | none     |
| 2: OpenCV.js 4.12 (WASM inlined) | 10.9 MB  | **3.5 MB** | Apache-2.0 | 316 ms   |

OpenCV.js is permissive and would pass the licence check, but it costs 3.5 MB gzip (about 6 %
of the 60 MB install reference) and buys nothing here: it is less accurate on every case and
slower. Its ORB also degrades on fine, repetitive line work: 42 inliers of 8,000 key points on
the dense A1 scan.

## Results: the "as is" check (D-60)

The plan asks for a score that says "these sheets already line up, use them as they are", with
a threshold.

- **A raster coverage score cannot do it.** The share of ink of each page with ink of the other
  within 1 px: at 50 dpi a sheet moved by 1 pt scores 0.906, the same as unmoved; at 150 dpi a
  sheet moved by 1.5 pt scores 0.751, while unmoved sheets with real changes score 0.795 to 0.82.
- **Feature agreement does.** The share of A's feature points (line ends, corners) with a
  feature point of B within **0.1 pt**, with no transform:

| Sheets                                                 | Feature agreement as is                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 35 unmoved vector sheet pairs of the corpus            | **0.598** (09 A2) to 1; 03 P3: 0.693, 01: 0.705, 04 P2: 0.707, 12 A1: 0.747; most 0.9 to 1 |
| Corpus sheets that are moved (03 P1, 03 P2, 04 P1, 15) | 0                                                                                          |
| Micro moves of a real sheet: 0.5 pt, 0.7 pt, 1 pt      | 0 to 0.001                                                                                 |
| 1.5 pt, 2 pt                                           | 0.049, 0.096                                                                               |
| 0.11° about a corner; 100.1 %                          | 0.024, 0.024                                                                               |

**Rule proposed for M12-10:**

1. Feature agreement **≥ 0.3**: use as is (no alignment). It takes 2 to 13 ms a sheet (240 ms
   on the dense A1).
2. Otherwise align (route 1) and keep the result only if it agrees better than as is. On every
   corpus sheet route 1 found identity for the unmoved sheets and the true transform for the
   moved ones.
3. Pages without usable geometry (scans): always align with the image method.
4. **Low confidence** (show "check alignment"): vector inlier share below 0.3, or fewer than 6
   agreeing tiles for a scan. Lowest seen: 0.707 (vector), 6 of 9 tiles at the coarsest level
   (scans).

## Results: pairing (D-60)

Signature per page (10 to 40 ms): a **32 × 32 ink thumbnail** (square root, blurred,
normalised) and the page's **words** weighted by tf-idf over both files. Similarity = half the
thumbnail correlation plus half the word cosine. Pairs are assigned by an **order-keeping
dynamic programme** (a longest common subsequence over similarities above **0.35**), then
leftovers greedily; what is left is "added" or "removed".

| Pairs tested                            | Ink + text             | Ink only                                           |
| --------------------------------------- | ---------------------- | -------------------------------------------------- |
| All 19 overlay pairs                    | **19 / 19**            | 18 / 19                                            |
| 02, 10 (same sheets)                    | correct, margin ≥ 0.50 | correct                                            |
| 05 (a sheet added: 3 → 4)               | correct, margin 0.268  | correct, margin 0.121                              |
| 17 (S-103 removed, S-105/S-106 swapped) | correct, margin 0.111  | **wrong**: S-105 and S-106 have the same thumbnail |
| 06 (scan against scan)                  | correct, margin 0.101  | correct                                            |

Margin = the true pair's similarity minus the best wrong candidate's. The lowest true pair
scores 0.451 (06, scans, no text); the removed sheet of pair 17 scores 0.889 against a sheet
that is really paired elsewhere, so **a threshold alone cannot pair sets; the sheet order
does**. Text is needed (pair 17); scanned sets have only ink, which is why the editable pairing
table (M12-09) and file names for sets stay.

## Results: difference detection (D-61)

Method (`detect.ts`): B is rendered at the analysis resolution; A is rendered by PDFium
**straight through the alignment into B's frame** (no raster resampling). Ink masks at level
96 of 255; a mark of one revision is unchanged when the other has ink within `tol` px
(Chebyshev); what is left is grouped on cells of 3 pt (marks closer than 6 pt join) and
regions smaller than `minPx` changed pixels are dropped. A **text layer** compares positioned
words of A (moved) and B and reports a word not found at its place.

On 39 sheet pairs with 240 true differences (control sheets included: 10 A2, 15, 16 ×2, 17
S-101/102/105/106):

| Setting                      | Found         | Found by raster alone | False reports | On control sheets | Time median / max | Peak memory |
| ---------------------------- | ------------- | --------------------- | ------------- | ----------------- | ----------------- | ----------- |
| 72 dpi, tol 1                | 240 / 240     | 149                   | 1             | 0                 | 53 / 383 ms       | 81 MB       |
| 100 dpi, tol 1               | 240 / 240     | 208                   | 0             | 0                 | 76 / 651 ms       | 156 MB      |
| 100 dpi, tol 1, min 3        | 240 / 240     | 221                   | 0             | 0                 | 74 / 795 ms       | 156 MB      |
| **150 dpi, tol 1** (High)    | **240 / 240** | **232**               | 1             | 1                 | 172 / 1,641 ms    | 350 MB      |
| 150 dpi, tol 1, min 3        | 240 / 240     | 237                   | 1             | 1                 | 172 / 1,680 ms    | 350 MB      |
| **150 dpi, tol 2** (Normal)  | **240 / 240** | 183                   | **0**         | **0**             | 178 / 2,120 ms    | 350 MB      |
| 150 dpi, tol 1, smooth edges | 240 / 240     | 230                   | 1             | 0                 | 174 / 1,626 ms    | 350 MB      |
| 200 dpi, tol 1               | 240 / 240     | 237                   | 1             | 1                 | 315 / 2,892 ms    | 622 MB      |

Time = render both + detect, per sheet. The largest sheets: dense A1 (pair 14, 17 MP at
150 dpi) 1.1 s; ARCH E (13 P2, 39 MP) 1.5 s.

- **The one false report** at tol 1 is pair 15 (an A1 sheet against its A3 print): the frame
  line's weight scales with the sheet, so at A3 it is 1 px thinner along its whole length. Tol 2
  takes it away. This is the "sensitivity" the plan already gives the user.
- **Raster alone misses 8 differences** at 150 dpi, tol 1: a single digit changed in 7 pt text
  (0 → 8, 6 → 8) moves fewer pixels than the tolerance hides. The text layer catches all of
  them, so the **text-aware entries are needed**, not optional.
- **Scans need their own setting.** On pair 06 (real 150 against 200 dpi scans, noise, 0.5°
  skew) the vector setting reports 52 regions (scan noise and edge jitter). With **tol 3 px,
  ink level 128, minimum 80 px** it reports **11 regions, all real**: the partition removed
  (with the new column C-4 inside it), the stair moved right (removed and added outline), the
  labels that moved with them and the new column's label. All three manifest changes are found.
- **Memory:** a whole sheet at 150 dpi holds two ink rasters, two masks, two dilated masks and
  the result: 350 MB for ARCH E, 622 MB at 200 dpi. **The detector must work in bands** (rows
  of, say, 512 px with `tol` rows of overlap, and the grouping grid carried over), which brings
  the peak to tens of MB at any sheet size. Rendering already works in bands.

### Proposed settings for M12-14

| Setting                   | Value                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Analysis resolution       | 150 dpi (100 dpi gives all 240 too, with the text layer, at half the time: a fallback for very large sheets) |
| Ink level                 | 96 of 255 (vector); 128 (scans)                                                                              |
| Sensitivity High / Normal | tol 1 px / tol 2 px at 150 dpi (0.48 / 0.96 pt). Default Normal: no false report on the corpus               |
| Scans                     | tol 3 px, minimum region 80 px                                                                               |
| Grouping                  | marks within 6 pt form one region                                                                            |
| Minimum region (vector)   | 3 to 6 px; the plan's "minimum size" control                                                                 |
| Text layer                | always on for pages with text                                                                                |
| Memory                    | bands, never a whole sheet raster at once                                                                    |

## Numbers for the plan's acceptance table (for ADR-032)

| Check                         | Plan's proposal                        | Measured here (route 1)                                     | Proposal for ADR-032 |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------- | -------------------- |
| Differences found             | every manifest difference              | 240 / 240 true items on 39 sheets; all 3 on the scan pair   | keep                 |
| False reports                 | none on control pages; none on pair 16 | 0 at Normal (tol 2); 1 at High (pair 15, line weight)       | keep, at Normal      |
| Alignment, vector             | 0.5 pt, 0.05 %, 0.05°                  | ≤ 0.003 pt, 0.0002 %, 0.0000° on 15 cases                   | keep                 |
| Alignment, scans              | 2 px at 150 dpi                        | ≤ 0.25 px (0.121 pt) on 5 cases                             | keep                 |
| Typical A1 sheet              | aligned and listed ≤ 2 s               | 0.3–0.4 s align + 0.2 s detect (as-is sheets: 0.01 + 0.2 s) | keep                 |
| Dense A1 (measured, reported) | —                                      | 1.3–1.7 s align (moved) + 1.1 s detect; as is: 0.24 + 1.1 s | report               |

## Corpus bugs found and fixed

The independent truth found two bugs in the M12-01 generator (`e2e/fixtures/comparison-corpus/drawings.ts`); both files were regenerated with `npm run corpus`:

1. **Pair 15:** the A3 copy's `cm` was written with 3 decimals (0.499 instead of the manifest's
   0.49941, 0.08 % off, beyond the 0.05 % target). Now written with 6.
2. **Pair 18:** Rev C's drawing area moved 7.09 pt down when its revision table grew, contrary to
   the manifest ("drawing area identical"). Both revisions now lay out the sheet from the same
   title block size.

## Risks

1. **Times are from one core in the cloud container**, not the reference machine. The browser
   will run the same code in the Compare worker (D-66); M12-07's perf test measures it there.
2. **The truth is ours too.** It is independent of the detector (vectors and characters, not
   pixels), and its visibility check was tuned on this corpus. M12-23's owner hand check on real
   drawings stays the final word.
3. **Scans:** the scan setting was checked on one real pair (06). Real scans with folds, stamps
   and handwriting will report more; ignore zones and the minimum size are the answer the plan
   already has.
4. **Sheets with no geometry and no text** (pure images) only have the image method; very
   sparse pages may get few agreeing tiles, which the low-confidence state covers.
5. **Pairing scanned sets** relies on ink and order only (no text); a swapped pair of
   near-identical scanned sheets will need the pairing table.
