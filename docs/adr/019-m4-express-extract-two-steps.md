# ADR-019: M4 — Express Extract in two steps (Find Tables, then Save…)

- **Status:** Accepted (owner, 2026-10-01). Applied: ARCHITECTURE.md Rev 0.7 (§7.7).
- **Date:** 2026-10-01
- **Deciders:** Owner; recorded by the coding agent
- **Related decisions:** §7.7, ADR-015, M4-Q5; M4-13; CLAUDE.md rules 1, 2, 9

## Context

ARCHITECTURE.md §7.7 (Rev 0.6) described Express Extract as "one click → auto-detect selected
pages → XLSX/CSV, no review". Building it (M4-13) showed that one click cannot both detect and
ask where to save:

- The browser's save and folder pickers (`showSaveFilePicker`, `showDirectoryPicker`) need a
  fresh user activation. Detection runs in the Work worker for up to seconds (200 pages ≈ 3 s), so
  the click's activation has expired by the time the tables are known.
- Asking where to save first, in the same click, creates the target file before anything is
  known: when no table is found, an empty file is left behind. It also has to fix the
  packaging (one CSV, a folder, a ZIP — M4-Q5) before the number of tables is known.

## Options

1. **Two steps**: Find Tables (detection with progress and Cancel) → the result ("n tables
   found", "No tables found", the OCR note) → Save… asks where to write it.
2. One click that asks where to save first; an empty file remains when nothing is found.
3. One click that downloads to the browser's Downloads folder (no picker) once tables are found.

## Decision

Option 1. The dialog keeps the format choice (XLSX/CSV) and runs detection on the thumbnail
selection, else the current page; Save… then picks the target with the packaging that fits the
number of tables found. Still no review step.

## Consequences

- §7.7 reads: "Express Extract: Find Tables → auto-detect selected pages → Save… as XLSX/CSV,
  no review (two clicks: the save picker needs a fresh click, and nothing is created when no table
  is found — ADR-019)."
- Nothing is written when no table is found; the user sees why before choosing a file.
