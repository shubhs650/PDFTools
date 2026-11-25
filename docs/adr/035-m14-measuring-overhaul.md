# ADR-035: M14 — Measuring overhaul for version 1.2.0

- **Status:** Accepted by the owner on 2026-11-25: the decisions (41 questions answered one at a
  time, then the written summary) and the plan [docs/plan/M14.md](../plan/M14.md) ("I approve the
  plan, proceed").
- **Date:** 2026-11-25
- **Deciders:** owner (Shubham) / agent (M14 planning thread)
- **Adds:** D-73 … D-79. **Amends:** §7.4, §7.5, §13 of ARCHITECTURE.md (Rev 0.26).
  **Supersedes:** ADR-007 decision 2 (a grouped FreeText label beside each measurement).
- **Spike to follow:** S34 (every measurement kind as one markup) records its result here as
  Amendment 1 before the tasks that build on it.

## Context

Version 1.1.0 measures distance, perimeter and area. The owner found two bugs: zooming or panning
during a Distance, Perimeter or Area restarts it on the next click (Calibrate survives the same
view change), and a Distance opened in another desktop PDF editor selects and deletes its value
apart from its arrows and lines. He also found no way to select, resize, edit or delete a scale
viewport, and asked for the measuring toolset engineers expect for review and takeoff without
making the UI or the architecture much heavier.

The owner exported the same two dimensions from Triya PDF and from another desktop editor as FDF.
The other editor writes each dimension as a single `/Line` (`/IT /LineDimension`, `/Cap true`,
`/CP /Inline`, `/LL`, `/LLE`, the value in `/Contents` and `/RC`, the caption drawn in the
line's own appearance). Triya PDF writes a `/Line` plus a `/FreeText` tied to it with `/IRT` and
`/RT /Group` (ADR-007 decision 2), and other editors treat a group as two items.

ADR-007 chose the grouped label because, at the time, PDFium drew every appearance (ADR-001 B7)
and a custom appearance looked like a conflict. Since then the Render worker draws its own
appearance for text comments (D-52), text and border colours (ADR-024) and dimension leader lines
(D-72), so drawing the value into the markup's own appearance follows an established pattern.

## Decision

1. **D-73 Measuring toolset.** Ten tools in four Measure ribbon groups: Length (Length,
   Polylength, Perimeter), Area (Area, Volume, Cutout), Curves and angles (Angle, Radius,
   Diameter), Count; Home and Comment carry one Measure split button (last tool used, all tools in
   its menu). Length replaces Distance and keeps the sideways offset of D-72 (a double-click or
   Enter places it with none). Polylength is an open path; Perimeter always closes. Area has
   straight edges. Volume is an area times a remembered Depth. Cutout cuts holes into an Area or
   Volume. Angle by three clicks (inside angle). Radius and Diameter by centre and edge, or by three
   points on the curve. The sheet shows the value alone, with an optional label in front; the tool
   name is the subject. Area and volume have their own units and decimals (m² and m³ by default for
   metric). Each tool remembers its own style. Review comes first; totals and export are a light
   takeoff layer, not an estimating product.
2. **D-74 One markup per measurement.** Every measurement is one standard annotation whose own
   appearance, drawn by the Render worker, holds the geometry and the value; the value is also its
   `/Contents`. Length is a `/Line` with `/Cap true` and `/CP /Top` (default) or `/Inline`.
   Distance, perimeter and area keep the standard `/Measure` data; kinds with no standard type use
   the nearest standard subtype, chosen by spike S34. What only Triya PDF needs to edit a
   measurement again (tool, label, count group and number, depth, holes, caption position, arc) is
   kept in the page's `/PieceInfo` (ISO 32000-1 §14.5), keyed by the annotation's `/NM`, never as
   extra keys on the annotation (rule 6). No other product's private takeoff data is copied or
   matched. Files saved by 1.1.0 get a one-click "Update old measurements" information bar that
   turns each Line-plus-FreeText pair into one Line; nothing changes without it.
3. **D-75 Count.** One small symbol markup per click with its number beside it in the same markup;
   count groups (name, shape, colour from the swatch picker, size) chosen before clicking; numbers
   per group across the document; deleting leaves a gap, "Renumber group" closes gaps on request.
   A screen-only view option, off by default and toggled from the status bar, keeps count numbers
   the same size on screen at any zoom, small and see-through, capped at about 4 times their saved
   size relative to the page.
4. **D-76 Measurements pane and export.** A Measurements pane in the left rail lists measurements
   by tool and count group with totals, This page or All pages, flags for spanning and paper-size
   values, and a Scales section with every page's viewports. Measurements stay in the Comments pane
   behind a filter; Export CRS includes them only when asked. Export to Excel (fixed layout:
   measurements, totals) and CSV, with optional pictures framed as the CRS does; "Attach to this
   PDF" replaces an earlier attached copy and the pane flags it when out of date (never on
   Ctrl+S). "Place summary" puts one table markup with the totals on the sheet, kept up to date
   by Triya PDF.
5. **D-77 Scales and viewports.** Viewports are selected, moved, resized, deleted and edited on the
   page while the Measure tab is open, and listed in the Scales section. Any scale change (a
   viewport's scale, its place or size, a recalibration) updates every measurement that uses it in
   one Undo step, with a note. The first measurement of a size on a page without a scale asks once:
   Set scale, Calibrate or Measure at paper size. A measurement whose points fall in two scale
   areas warns while drawing and, if placed, shows no number and stays out of totals.
6. **D-78 Measuring interaction.** A measurement in progress survives every view change (zoom,
   pan, scroll, loupe, Previous and Next view); only Esc, another tool or a page change ends it.
   Shift locks to 0°, 45° or 90° and still snaps to where the locked direction meets a drawn line.
   Placed measurements are edited point by point (drag, add, remove) with live values. Every
   control is keyboard-reachable and placed measurements move with arrow keys; new points need a
   pointer.
7. **D-79 Acceptance.** Done means one test file holding every tool, checked by the owner in Adobe
   Acrobat Reader, a second desktop PDF editor and the PDF viewer in Chrome or Edge: each
   measurement looks right, selects, moves and deletes as one item, and its value can be read
   (D-33 stands: Bluebeam Revu is not a required viewer). Self-made test drawings with known true
   values (`Synthetic PDF Corpus/measure/`) back every e2e test. Version 1.2.0 ships after this
   check; 1.1.0 is tagged first, unchanged.

## Consequences

- No new dependency is planned. ExcelJS (MIT), already used for the CRS, builds the export.
- The Render worker draws the appearance of every measurement kind; both workers read the Triya
  data back from `/PieceInfo` (as they read `/LL` today, D-72).
- `ViewportList` in the Properties pane moves into the Measurements pane's Scales section.
- Saving stays incremental (rule 7): new and changed markups and the page's `/PieceInfo` go into
  the single Ctrl+S revision; an attached export is written only when the person asks.
- Help gains topics for the new tools, the pane, viewports and export; What's new gets a 1.2.0
  entry.
- Left out (owner, 2026-11-25): curved Area edges (a later spike), style presets, export into
  project templates, page overview pictures, merged count bubbles, an angle from two picked lines,
  keyboard point placement and typed lengths, measurements across pages, slope, pitch, dynamic fill
  and 3D.

## Amendment 1 — S34: every measurement kind as one markup (M14-01, 2026-11-25)

- **Status:** **Accepted by the owner on 2026-11-25.** He checked the pack in Adobe Acrobat
  Reader, the second desktop PDF editor and the Chrome or Edge viewer and answered "Everything
  works well" (the M14-01 owner gate). M14-03 and the tasks after it build on these decisions.
- **Evidence:** [spikes/s34-measure-markups/RESULTS.md](../../spikes/s34-measure-markups/RESULTS.md),
  the pack `Synthetic PDF Corpus/measure/interop/S34_interop_pack.pdf`, the checklist
  [OWNER-CHECK.md](../../spikes/s34-measure-markups/OWNER-CHECK.md), and 19 tests in
  `spikes/s34-measure-markups/s34.test.ts`. The measure corpus (D-79) is in
  `Synthetic PDF Corpus/measure/`: seven sheets and a manifest of true values, written by
  `npm run corpus:measure`.

**Findings.** Every kind saves as exactly one annotation, its value drawn into its own appearance
in embedded fonts that ship with the app, and its value in `/Contents`. All 40 measurements of the
pack read back whole from the page's `/PieceInfo`, and the data survives a later Ctrl+S. Chromium's
own viewer, PDFium and Poppler show the pack as drawn. A viewer that redraws an annotation from
its dictionary (PDFium as the stand-in) keeps a Line's, PolyLine's or Polygon's geometry but drops
its caption, fill and holes. It draws a Circle or Square across the whole `/Rect` (ignoring `/RD`), and
never touches a Stamp.

**Decisions (D-74 detail):**

1. **Subtypes.**
   - Length is a `/Line` (`/IT /LineDimension`, `/Cap true`, `/CP /Top` or `/Inline`, `/LL`
     `/LLE` `/LLO` for its offset, `/Measure`).
   - Polylength and Perimeter are a `/PolyLine` (`/IT /PolyLineDimension`, `/Measure`). A
     Perimeter repeats its first vertex.
   - Area, Volume and Cutout are a `/Polygon` (`/IT /PolygonDimension`, `/Measure`, no `/IC`:
     the fill is drawn only in the appearance).
   - **Angle, Radius, Diameter and Count are `/Stamp`s**, because a Stamp's appearance is never
     redrawn. The alternatives (PolyLine, Circle, Square) are in the pack for comparison.
   - The summary table is a `/FreeText`.
   - Every measurement has `/Subj` set to its tool name and an `/NM`.
2. **Captions** are shaped and embedded by the comment-font pipeline (D-52, rule: only fonts
   shipped with the app). Above puts the caption on the reading side, and In line cuts a gap into
   the line. Holes are cut with an even-odd fill. Each caption costs 1.5–3 kB of font subset, so
   M14-03 and M14-07 share one font object per face across a document's measurements, rewritten
   with the union subset in the Ctrl+S that adds glyphs.
3. **Triya data.**
   - Format: page `/PieceInfo << /TriyaPDF << /LastModified … /Private << /Type
/TriyaMeasurements /V 1 /Items << /<NM> entry … >> >> >> >>` plus page `/LastModified`.
   - Each entry holds the tool, label, count group, number and shape, depth, unit and decimals,
     holes, arc, scale, and a fingerprint of the geometry (0.01 pt).
   - It is written through the object layer's page patches, so it goes into the one Ctrl+S
     revision (rule 7).
4. **Reading back.**
   - When the fingerprint matches, everything is restored.
   - When another editor moved or reshaped the markup, its tool, label, group, number and depth
     are kept, and its holes and arc are dropped.
   - Without data, the standard kinds come back from `/IT` and the geometry (a Volume or Cutout
     as an Area). The rest stay plain markups that show and print as drawn.
5. **Cutout holes.** The outline is the Polygon's `/Vertices`. The holes are in the Triya data
   and are cut out of the appearance (even-odd fill, dashed hole outlines).

**The owner's check (2026-11-25).** The two open questions were whether Acrobat Reader or the
second editor drops the value of a moved Line, PolyLine or Polygon, and whether Stamps are
acceptable for Angle, Radius, Diameter and Count. The owner answered for the whole pack:
"Everything works well". So the proposals stand: Stamps for Angle, Radius, Diameter and Count;
the alternatives on page 3 of the pack are not used.
