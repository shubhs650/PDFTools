# ADR-030: Comparison is unblocked

- **Status:** Accepted (owner, 2026-11-22). Applied: ARCHITECTURE.md Rev 0.20.
- **Date:** 2026-11-22
- **Deciders:** owner (Shubham) / agent (comparison planning thread)
- **Related decisions:** D-12 (licences), D-57 (clean public tree); CLAUDE.md rules 5, 13, 14
  and 15
- **Related spike / milestone:** the comparison milestone (to be planned)

## Context

ARCHITECTURE.md §14 listed revision compare as **parked**: blocked pending the owner's
clearance, not to be designed or built until explicitly unblocked, and then only as a
clean-room implementation from public techniques. §1.5 listed it as a non-goal and CLAUDE.md
rule 14 forbade work on it.

On 2026-11-22 the owner decided to add comparison to Triya PDF (PDF overlay for drawings, text
comparison for documents), confirmed that the hold is lifted, and asked for rule 14 to be
removed.

## Decision

1. **The hold is lifted.** Comparison may be designed, planned and built. It gets its own
   milestone plan and ADR, reviewed by the owner before any code, as every milestone does.
2. **The clean-room condition stays** and takes the place of the old rule 14: comparison is
   built from public techniques and permissively licensed libraries only; no code, artwork or
   proprietary behaviour is copied from another product's comparison feature (rules 5 and 15
   apply as before).
3. **ARCHITECTURE.md Rev 0.20:** §1.5 no longer lists revision compare as a non-goal; §14's
   "Parked" entry becomes "Comparison (unblocked)".
4. **CLAUDE.md:** rule 14 now states the clean-room condition. The slot is kept so that rule 15
   keeps its number, which code comments and earlier documents cite.

## Consequences

- Earlier plans and ADRs that say "revision compare (parked, rule 14)" describe the state at
  their time and are left as written.
- This ADR sets no scope, design or schedule for comparison; the milestone plan does.
- The test corpus for comparison (`Synthetic PDF Corpus/`, self-made PDFs, rule 13) is in the
  tree; one line of its text-corpus README named other PDF products and failed the D-57 name
  test, so it is reworded here.
