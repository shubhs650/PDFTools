# ADR-029: V1 — version 1.0.0, release domains, deploy from a tag, and a clean public tree

- **Status:** Accepted (owner, 2026-11-18, answers to the [V1 plan](../plan/V1.md) Q1–Q7).
  Applied: ARCHITECTURE.md Rev 0.19.
- **Date:** 2026-11-18
- **Deciders:** owner (Shubham) / agent (V1 planning thread)
- **Related decisions:** D-12 (licences), D-22 (no network), D-28 (domain), D-35 (app shell),
  D-41 (product name), D-48 (About); ADR-003 (no wrangler dependency), ADR-021, ADR-026 (Help),
  ADR-027 (What's new); CLAUDE.md rules 4, 5, 13 and 15

## Context

The owner is releasing Triya PDF as **1.0.0** on `triya-pdf.openengtools.com` and
`app.triyapdf.com`, deployed from a tag. The top bar's home button points to one site; the
public repository still names the desktop editor the layout was modelled on, holds screenshots
of its ribbon (`docs/ui-reference/`) and third-party PDFs (`corpus/`). Findings and options are
in the plan.

## Decision

- **D-28 (amended):** the release domains are `triya-pdf.openengtools.com` and
  `app.triyapdf.com`, both serving the app (plan Q2; each is its own origin, so installs and
  data on the device are per domain), served by a separate
  Worker (`triya-pdf`) deployed **only** by `.github/workflows/release.yml` from a tag
  `vMAJOR.MINOR.PATCH` that matches `package.json` and is on `main`, after one click of approval
  in the GitHub environment `production` (plan Q4). The beta Worker `pdftools`
  keeps deploying `main` as the staging site, with PR previews (plan Q3). wrangler still runs only in CI (ADR-003).
- **D-35 (amended):** the top bar has no home button; About gains **Source code on GitHub**
  (a user navigation in a new tab; the app makes no request).
- **D-57 (new):** the public tree never names other PDF products' UI as a model and carries no
  third-party artwork or documents. The layout description stays generic ("a classic ribbon PDF
  editor layout"); interop is described as "Acrobat Reader and other viewers". A unit test fails
  if the name returns. `corpus/` and `docs/ui-reference/` are removed; test data stays public or
  self-made (rule 13).
- **What's new:** one entry for 1.0.0, the first public release (plan Q6); beta entries leave
  the app.

## Consequences

- ARCHITECTURE.md Rev 0.19: D-28, D-35, D-41 (domain text), §8 ribbon note (no
  `docs/ui-reference/`), new D-57.
- CLAUDE.md: opening line, rules 5 and 15 and the session protocol line reworded without the
  name.
- History of the public repository is left as it is (plan Q5 (a)): earlier commits and pull
  requests keep the removed files and wording.
