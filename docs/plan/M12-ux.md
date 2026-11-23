# M12-ux — Compare made easier to use (before v1.1.0)

> **Status (2026-11-23):** **approved** by the owner ("Plan is approved now, start working on it
> in new threads"), with the recommended answer to each choice C1 – C4 and the further
> improvements 1 – 7 (8, a picture of each difference in the list, set to **No**).
> [ADR-033](../adr/033-m12-compare-usability.md) records the design changes (D-58, D-60, D-62,
> D-64); ARCHITECTURE.md Rev 0.23. Each task is built in its own thread and PR, in the order
> under "Order of work".

Source: the owner's hand check of M12 on the beta site (2026-11-23): "Everything looks good but
there are few corrections wrt UI flow, user interaction", with an annotated list of corrections,
plus: "Manual align feature is difficult to understand first (and find first). Look for more
improvements in UI we can do so non-techy engineers can easily understand the UI."

## The owner's choices

| Choice                         | Answer (recommended)                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1. Page previews when pairing | A thumbnail of the A and B page in every pairing row; click one to pick from a grid of that file's pages; a **Preview pair** button shows both pages large.           |
| C2. "Change inputs"            | Removed. **New comparison** opens a new comparison tab with the same files and type already filled in; the result stays open in its own tab.                          |
| C3. More room to work          | Every comparison pane folds away and can be resized; a **Maximise** button hides the ribbon and all panes until Esc.                                                  |
| C4. Release                    | These changes go into **v1.1.0**. The owner re-checks the changed screens and accepts M12; then Compare is switched on in release builds and the owner tags `v1.1.0`. |

## Tasks

### M12-24 (A) — The input window

- **Pairing previews:** every pairing row shows the A and the B page side by side, about 160 px
  wide, drawn lazily in the Render worker as rows scroll into view (no main-thread work).
- **Page picker:** clicking a picture or its page list opens a grid of every page of that file,
  the current one marked; a click pairs it; "None" stays first. Arrow keys and Enter.
- **Preview pair:** an eye button per row shows both pages large, side by side, with Previous
  pair / Next pair.
- Rows that need a look (match under 50 %, added, removed) carry a **Check** mark.
- **Step guide** at the top ("1 Choose files · 2 Check pairs · 3 Compare") and a **Compare button
  that stays in view** at the bottom (extra 3).
- **New comparison** replaces **Change inputs** in the overlay and text result headers (C2): a new
  comparison tab, same files, same type, same options. A result never goes back to its input
  in the same tab; the code path for that is removed (`stage: 'input'` after a result).
- Screens: input window, pairing with previews, page picker, Preview pair (light and dark).

### M12-25 (B) — Room to work

- The overlay's left pane (Sheets, Alignment, Compare an area, Comments, Ignore zones), the
  Differences pane and the Close-out pane each get a **fold** button on their edge (like the
  app's side panes, D-56), a thin strip to open them again, and a **drag edge** to resize;
  remembered per comparison. The same for the text comparison's right pane.
- The app's **Thumbnails pane closes itself** on a comparison tab (it only says "Open a document
  to see its pages" there); opening it from the rail still works.
- **Maximise** in the comparison header hides the ribbon, the app panes and the comparison panes,
  leaving the windows and the floating bar; Esc or the button restores (C3).
- **Text labels** on the header buttons: "Side by side", "Overlay only", "Link views",
  "Differences", "Close-out"; icons only when the window is narrow (extra 1).
- A **colour key** on the floating bar: "Red: only in old · Green: only in new · Black: same",
  following the chosen colours (extra 2).
- **Left-pane sections fold**: Sheets open; Alignment, Compare an area, Comments and Ignore zones
  fold to a one-line summary (extra 4).
- **Plain words** in the differences list: "Geometry" → "Drawing", "Text and geometry" → "Text
  and drawing"; Sensitivity and Minimum size fold under **Filters** (extra 5).

### M12-26 (C) — Alignment and first-time tips

- **Plain status words** per sheet: "Lined up automatically", "Already lined up" (was "As is"),
  "Check alignment" (was "Low confidence"), "Lined up by hand", and a new "Checked by you".
- A **Line up** button on the floating bar, always in sight.
- A **banner** across the top of the overlay on a sheet that needs checking: "This sheet may not
  be lined up correctly." with **Line up by hand** and **It looks right** (marks the sheet
  "Checked by you"; saved in the comparison file's data).
- **Guided steps** (replaces "Align by points"): a step bar above the windows — 1. click a point
  you can find on both drawings (a grid crossing, a corner) on the old drawing; 2. the same point
  on the new drawing; 3. optional second pair, far from the first; 4. Apply. The window to click
  has a blue outline; picked points are numbered pins in both windows; the overlay updates
  live; Undo last point and Cancel.
- **Fine-tune** (typed shift, scale, rotation; nudge arrows) folded by default. Apply to: This
  sheet (default), All sheets, Sheets that need checking.
- Help topic `compare-alignment` gets one picture per step.
- **First-time tips** (extra 7): three short pop-ups on the first comparison (the colours, the
  differences list, lining up); never shown again; Help can replay them.

### M12-27 (D) — Review

- **Unsaved dot** after the window titles "Document A (old): …" and "Document B (new): …" (overlay
  Review layout and text comparison windows) and on the comparison tab, when that document has
  unsaved changes; the same dot and accessible name as the document tabs. Closing the comparison
  tab asks before losing unsaved comments (add it if it does not).
- **Close-out list:** comments with typed text first (notes, text boxes, callouts, any markup with
  contents), then markup without text; each group by page, then position. A **Hide highlights**
  box next to All / Open / Closed, remembered.
- **Click to zoom:** a click on a close-out row zooms the linked windows so the comment fills about
  a third of the window (never past 400 %), selects it and flashes it once (`centreOnBox` in
  `review/windowLink.ts`); in a text comparison both sides scroll to it and zoom in if it is small.
- **Close out as…**: one menu with a line explaining Addressed, Carried over and Changed
  differently (extra 6).
- **Text comparison:** each window title shows "Page 12 of 140" for its side, updated while
  scrolling; clicking the number lets you type a page and press Enter; the other side follows to
  the matching place.

## Order of work

| Task       | Depends on                         | Starts                          |
| ---------- | ---------------------------------- | ------------------------------- |
| M12-24 (A) | —                                  | first, alongside B              |
| M12-25 (B) | —                                  | first, alongside A              |
| M12-27 (D) | — (rebases on B's pane changes)    | when the first of A or B merges |
| M12-26 (C) | B merged (floating bar, left pane) | when B merges                   |

Two threads at a time: **A and B first**; when one merges, start the next eligible (D any time,
C only after B). Threads rebase and resolve conflicts themselves.

## Every task

- Unit and e2e tests; axe in light and dark; perf scenarios with no main-thread task over 100 ms.
- i18n keys only; every control keyboard-reachable with an accessible name; Fluent icons.
- Help chapter text and screenshots (`npm run help:screenshots`) and a line in the 1.1.0 entry
  of `src/i18n/whatsnew.en.json`.
- Playwright screenshots (light and dark) in the project files under `m12-ux/`, posted in the
  thread as the screens take shape.

## Afterwards

The owner re-checks the changed screens (a short addition to `docs/acceptance/M12.md` §5) and
accepts M12; then `VITE_COMPARE=off` is removed from the release workflow and the owner tags
`v1.1.0`.
