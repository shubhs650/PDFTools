# ADR-033: Compare made easier to use (after the M12 hand check)

- **Status:** Accepted by the owner on 2026-11-23 with the approval of the plan
  [docs/plan/M12-ux.md](../plan/M12-ux.md) (choices C1 – C4 as recommended).
- **Date:** 2026-11-23
- **Deciders:** owner (Shubham) / agent (M12 acceptance thread)
- **Amends:** D-58, D-60, D-62, D-64 ([ADR-031](031-m12-pdf-comparison.md)); ARCHITECTURE.md §7.16
  (Rev 0.23)

## Context

The owner's hand check of M12 on the beta site found the Compare screens correct but hard to
follow for engineers who are not software people: pages could not be seen while pairing them,
"Change inputs" left a result in a confusing state, the panes could not be hidden, the close-out
list did not lead to the comment, the text comparison had no page number or Go to page, and
manual alignment was hard to find and to understand.

## Decision

1. **Input (D-58):** the pairing table shows a thumbnail of both pages in each row, with a page
   picker grid and a large **Preview pair**. A result no longer returns to its input in the same
   tab: **New comparison** opens a new comparison tab with the same files, type and options
   ("the inputs can be revisited" is replaced by this).
2. **Workspace (D-62):** every comparison pane folds and resizes, the app's Thumbnails pane closes
   on comparison tabs, and **Maximise** hides the ribbon and all panes until Esc. Header buttons
   carry text labels; the floating bar shows a colour key.
3. **Alignment (D-60):** sheet status in plain words — Lined up automatically, Already lined up,
   Check alignment, Lined up by hand, Checked by you (new: the owner accepted the automatic
   result, saved with the comparison). Manual alignment is a guided **Line up** mode, opened from
   the floating bar or from a banner on a sheet that needs checking, with a step bar, numbered
   pins and Fine-tune folded. The maths (1 – 3 point pairs, Apply to) is unchanged.
4. **Close-out (D-62):** comments with text first, a Hide highlights filter, and a click zooms
   the linked windows to the comment. One "Close out as…" menu with an explanation per outcome;
   the stored result (status Completed plus a reply) is unchanged.
5. **Unsaved mark (D-62, D-64):** the window titles of Document A and B and the comparison tab
   show the unsaved dot of the document tabs.
6. **Text view (D-64):** each window shows "Page n of m" for its side, and the number takes a
   typed page (Go to page); the other side follows by content.
7. First-time tips on the first comparison, replayable from Help.

A picture of each difference in the differences list was proposed and declined by the owner.

## Consequences

- No change to the engines or the acceptance numbers. "Checked by you" is saved in the
  comparison data as a new optional field beside the alignment `status`
  (`docs/formats/triya-comparison-v1.md`), so existing comparison files stay readable.
- Four tasks M12-24 … M12-27; v1.1.0 waits for them and for the owner's re-check.
