# Spike S27 — several documents on screen together (M12-02)

Task M12-02 of [docs/plan/M12.md](../../docs/plan/M12.md) (D-58, D-62, D-64; ADR-031). Input for
**ADR-032 (M12 spike results)**, which task M12-06 writes for the owner's acceptance. No feature
code: everything here is in `spikes/s27-linked-views/`.

**Verdict: works with workaround, route 1.** EmbedPDF 2.15.1 (pinned, ADR-011) already keeps one
viewport, scroll, zoom, tile, selection, annotation and history state **per document**, and
mounts several viewports in one registry at once. The app's own view layer
(`DocumentHost`, `DocumentView` with every layer, its context menus, the comment tools,
Ctrl+Z/Ctrl+Y and the shortcuts) works unchanged in two and three windows side by side. One
EmbedPDF bug (tiles in linked windows) needs a small workaround, and the app's "one active
document" assumption needs a few changes, listed below. Nothing in the plan has to change.

## How it was tested

- `main.tsx` mounts the **real** `src/features/view/DocumentView` once per window over the one
  plugin registry and the shared Render, Work and storage workers, in three layouts: a single
  window (a document's own tab), two windows (Document A | Document B, the text comparison),
  and three (overlay large on the left, A and B on the right: the Review layout). Documents
  open through the app's own open pipeline (`openFiles`). The window the user presses, wheels
  or focuses becomes the app's active document (`documentStore.activate` and EmbedPDF's
  `setActiveDocument`), so commands, menus and undo act on it.
- `follow.ts` links windows: the leader's centre (page point) goes through a transform
  (`link.ts`, unit-tested) to each follower's page, and the follower takes the leader's zoom
  divided by the transform's scale. Followers move in the leader's scroll event, so every
  window paints in the same frame.
- Fixtures (`make-fixtures.ts`, self-made, rule 13): three dense **A0** sheets built with the
  M12-01 corpus generator (about 89,000 line segments each, a zero-width grid, hatching, every
  label as curves; 570 KB each), the third one moved by a known similarity (scale 0.96,
  rotation 0.6°, shift 40 / −25 pt); corpus pairs 15 (the same drawing at A1 and A3) and 19.
- `s27.spec.ts`: 8 Playwright tests in Chromium (headless, 1600 × 1000, the app's `_headers`
  with COOP/COEP), real mouse and keyboard where it matters. Numbers in
  `test-results/s27-results.json`.

```sh
SPIKE=s27 PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run spikes -- --project=s27
npx vitest run spikes/s27-linked-views   # the link transform
```

## Results

| Question (plan)                                      | Result                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two and three documents at once, each with tiles     | **Yes.** Each window renders its own tiles at its own zoom (2 and 0.5 side by side; three windows at 150 %). Panning one window leaves the others where they are.                                                                                                                                                                                                                 |
| Zoom, pan                                            | **Yes**, per window, with the real Hand tool and zoom.                                                                                                                                                                                                                                                                                                                            |
| Working comment tools                                | **Yes.** A rectangle drawn with the real tool in each of the three windows lands in that window's document.                                                                                                                                                                                                                                                                       |
| Undo                                                 | **Yes, per document.** Ctrl+Z in A undoes only A's comment, in the overlay window only the overlay's; Ctrl+Y redoes.                                                                                                                                                                                                                                                              |
| Context menus                                        | **Yes.** Right-click on B's comment opens the Comment menu for B; Delete removes B's comment and leaves A's. The Page menu opens in each window for that window's document.                                                                                                                                                                                                       |
| Selection                                            | **Yes.** Text selected in B stays B's; selecting in A gives A its own selection (pair 15).                                                                                                                                                                                                                                                                                        |
| One view driven by another through a transform       | **Yes.** Pair 15 (A1 against its A3 copy, scale 0.4994): after zoom and a real Hand drag the follower is within **0.2 px** of the spot, at zoom 3 / k; either window can lead. Three A0 windows (one rotated 0.6°) while panning every frame: within **0.7 px** at 100 % and 400 %. The link costs **0.1 ms** a frame (max 1.1 ms; 4–5 ms with the CPU slowed 4×).                |
| The same document in its own tab and in a comparison | **Yes, as one document:** the comment drawn in the tab is in the comparison window, the unsaved mark is the document's, and Ctrl+Z in the comparison undoes the tab's edit (one history). **But one view state:** coming back to the tab shows the comparison's zoom (0.4 instead of 1.25), so the comparison must keep the tab's place and give it back (done here within 1 px). |
| Memory, three A0 sheets                              | Below.                                                                                                                                                                                                                                                                                                                                                                            |
| Frame time panning three linked views                | Below: every frame on time, no long task, no long animation frame.                                                                                                                                                                                                                                                                                                                |

### Memory (renderer process: the page and all its workers)

| State                               | JS + WASM heaps¹ | Tile cache | Renderer RSS² |
| ----------------------------------- | ---------------- | ---------- | ------------- |
| Started, no document                | 60 MB            | 0          | 200 MB        |
| One A0 sheet, fit                   | 78–85 MB         | 1.8 MB     | 295 MB        |
| Three A0 sheets, three windows, fit | 88 MB            | 3.7 MB     | 333 MB        |
| … at 100 %, after linked panning    | 90–92 MB         | 9.5 MB     | 425–430 MB    |
| … at 400 %, after linked panning    | 95 MB            | 12 MB      | 510–530 MB    |

¹ `performance.measureUserAgentSpecificMemory()`: the page 18–25 MB, the Render worker (PDFium)
26 → 34 MB, the Work worker 27 → 36 MB. ² Resident memory of the renderer process, which also
holds decoded tile images. Three heavy sheets on screen stay far inside §12's reference of 2 GB
for five heavy tabs. Each further document costs a few MB of PDFium memory in each worker; the
decoded tiles are what grows, and they follow the window area and zoom, not the document count.

### Frames, panning the leader every frame for 4 s (three linked windows)

| Case                                    | Frames | p95     | Over 25 ms | Long tasks / long animation frames | Link error |
| --------------------------------------- | ------ | ------- | ---------- | ---------------------------------- | ---------- |
| 100 %, three linked                     | 241    | 16.7 ms | 0          | 0 / 0                              | ≤ 0.7 px   |
| 400 %, three linked                     | 241    | 16.7 ms | 0          | 0 / 0                              | ≤ 0.7 px   |
| 200 %, three linked, CPU slowed 4×      | 241    | 16.7 ms | 0–1¹       | 0 / 0                              | ≤ 0.7 px   |
| 100 % and 400 %, leader alone (control) | 240    | 16.7 ms | 0          | 0 / 0                              | —          |

After each pan every window is fully covered by sharp tiles again (with the workaround below).
Two runs; ¹ one frame of 33 ms in one of them. At 100 %, 99 of 241 frames had a follower held
at its scroll limit (risk 3); those are not counted in the link error.

**Sharp again after a jump** (400 %, to a spot not yet rendered): the leader alone **130–230 ms**,
three linked windows **480–610 ms**. The one Render worker renders the tiles of all windows in
one queue, so three windows take about three times as long (risk 2).

## Findings

1. **EmbedPDF tiling bug with several windows (workaround).** `@embedpdf/plugin-tiling` 2.15.1
   recalculates visible tiles from **one** throttled scroll listener for all documents
   (`throttle`, 50 ms, trailing, no `keyExtractor`; the zoom plugin keys its own by document).
   When two windows scroll within 50 ms, which linked windows always do, only the last one gets
   new tiles; the others stay on their blurry previews (measured coverage after a linked pan:
   0.44 – 1 – 1 stock, 1 – 1 – 1 with the workaround). **Workaround** (`keyedTiles.ts`): a second
   scroll listener keyed by document that calls the plugin's own `calculateVisibleTiles`,
   installed once with the registry. It reaches an internal of the pinned version, as the render
   queue ranker already does (`tileScheduler.ts`, ADR-011); a test fails if an upgrade changes
   it. Worth reporting upstream (MIT project).
2. **One document, one visible window.** EmbedPDF keys viewport, scroll, zoom and tiles by
   document id. Two windows showing the same document at once share one state: the tiles follow
   whichever window scrolled last (measured: the other window's tile coverage drops to 0). This
   is fine for M12, because a document's own tab and a comparison tab are never on screen
   together (one document area), but it rules out showing one document twice in one comparison
   (for example O1 "compare an area" on two parts of the **same** file) unless that file is opened
   a second time as a read-only copy.
3. **The app assumes one active document.** `documentStore.activeId` is used in 63 files (87
   places) as "the document the commands act on", and also as "the tab shown". With the focused
   window as the active document, commands, shortcuts, context menus, undo and the Properties
   pane follow the window in use with no change (tested). What must change is listed below.

## What the view layer must change (for M12-08, M12-11, M12-12, M12-19)

1. **Active tab and active document become two things.** The tab strip gets tab kinds
   (document, comparison) and its own active tab; `activeId` stays "the document commands act
   on" and is set by the focused window. A document can be open **without a tab of its own**
   (dropped into a comparison), with a reference count: closing a comparison closes the
   documents nothing else shows.
2. **`DocumentArea`** renders either one `DocumentView` (a document tab) or the comparison layout
   for the active tab. `DocumentView` needs no new mounting code: it already takes a
   `documentId` and keys everything by it.
3. **Focus follows the window**: a press, wheel or focus inside a window activates its document
   (store and EmbedPDF's `setActiveDocument`). The focused window shows it (focus ring).
4. **Controller calls take the window's document.** `controller.ts` resolves `active()` from
   `activeId`; `DocumentView`'s Ctrl+wheel zoom, paged-mode wheel turns and Home/End call it.
   They must pass their own `documentId` so a wheel over a window that does not have focus yet
   zooms that window (the spike worked around it by activating on wheel capture).
5. **Visible-first rendering for several windows.** `tileScheduler`'s single `viewFocus` and
   `tileCache.setActive` become a set of visible windows: the focused window's pages first, then
   the other visible windows, then the rest; visible windows' tiles are evicted last.
6. **The keyed tile listener** (finding 1) at `DocumentHost` start.
7. **A place per window, not per document.** The comparison keeps each document tab's place
   (zoom, centre, view mode) and gives it back when the tab is shown again; the comparison's own
   windows are one sheet at a time (paged). `lastView` (D-53) must record only the document
   tab's place, never a comparison window's.
8. **Linked sync** as in `follow.ts`: the leader is the window last touched; followers centre
   the mapped point at the leader's zoom ÷ scale, inside the leader's scroll event; a window in
   the middle of a zoom is retried on the next frame. EmbedPDF turns pages only by quarter
   turns, so Document A and B windows always show their own documents upright; a small rotation
   between revisions moves only the centre point, and only the overlay window draws A turned
   into B's frame (S29).
9. **The overlay window as a live window (proposal for S29 to confirm).** Open a small
   in-memory **notes document** per comparison (blank pages the size of B's sheets) as a third
   document in the registry and show it with `DocumentView`, its content layer replaced by the
   overlay renderer. The overlay window then gets every comment tool, menu, the Properties pane
   and its own undo with the same code as A and B, and its comments are exactly the
   comparison's notes that D-62 keeps out of A and B (saved into the comparison file, M12-20).
   The spike used a third A0 sheet in that window; S29 decides how the overlay pixels are drawn.

## Risks

1. **The tiling workaround uses an internal** (finding 1). Mitigation: pinned version, a test
   that fails when it changes, an upstream report.
2. **One Render worker for every window.** Three windows take about three times as long to get
   sharp after a jump (0.5–0.6 s against 0.13–0.23 s). Mitigation: focused window first (change
   5); S29 measures whether the overlay should draw in another worker; a second Render worker is
   possible later (about 30 MB of PDFium memory).
3. **Edges of the sheet.** A follower cannot centre a spot near the page edge when its window is
   larger than the leader's (the scroll stops at the edge): 99 of 241 frames at 100 % in the
   three-window layout. Mitigation: the comparison windows get a margin around the sheet (as
   desktop editors do), or the sync aligns the windows' top-left corners instead of their centres
   near the edge. To settle in M12-12.
4. **Not covered here** and left to the e2e of M12-12 and M12-19: note windows, search
   highlights, measurement and snapping across windows, form fields, splitter resizing, the
   Comments pane with several documents on screen, and real Chrome/Edge on a laptop GPU (the
   numbers here are headless Chromium in a 4-core container).
