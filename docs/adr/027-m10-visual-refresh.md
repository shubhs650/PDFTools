# ADR-027: M10 — visual refresh (design language v2, motion) and an in-app About with open-source licenses

- **Status:** Accepted (owner, 2026-11-16, with the plan's recommended answers Q1–Q6). Applied:
  ARCHITECTURE.md Rev 0.15. **Amended** the same day: the owner accepted all nine optional
  items (O1–O9), adding the one-row header, a bundled UI font, accent and density choices to
  D-47 and Create Blank PDF as D-49; ARCHITECTURE.md Rev 0.16.
- **Date:** 2026-11-16
- **Deciders:** owner (Shubham) / agent (M10 thread)
- **Related decisions:** D-01 (layout), D-12 (licenses), D-17 (offline), D-20 (icons, tokens),
  D-22 (no network), D-30 (accessibility), D-36 (adaptive ribbon), D-37 (comment colours), D-42
  (dark theme), ADR-010 (Fluent icons); ARCHITECTURE.md §8, §9, §10.3
- **Related milestone:** M10 ([plan](../plan/M10.md))

## Context

Engineers who used the beta called it a "solid tool but basic UI": flat grey theme, plain
colours, no motion. The owner asked (2026-11-16) for a polished look **without changing the
overall layout**, based on an external UI review (`Triya_PDF_UI_Modernization_Report.pdf`, kept
outside the repository), and reported that **About** is too basic and its **third-party notices**
link does not work.

ARCHITECTURE.md §8 already requires design tokens (colour, spacing, type, radius, elevation) as
CSS variables, Fluent System Icons, a light default and a dark theme. It says nothing about
**motion**, and the About page is only listed ("about/privacy"). The plan checks the report's
claims against the app; the relevant findings for this ADR:

- The report proposes Lucide icons. Rule 15 and ADR-010 require Fluent System Icons; the icon
  contrast bug it saw is a CSS colour-inheritance bug, not an icon-set problem.
- The report's dark values fail WCAG AA (white on `#3b82f6` 3.7 : 1; `#64748b` on `#0f172a`
  3.75 : 1).
- The notices link fails because the service worker answers every navigation with `index.html`
  (since M1), so a new tab for `third-party-notices.txt` opens the app again once the service
  worker is in control.

## Options considered

1. **Token values only** (new colours and radii, nothing else). Cheap, but leaves the static feel,
   the native controls and the empty start screen: the engineers' main complaints.
2. **Visual refresh inside the current layout** (chosen): new token values, styled controls,
   ribbon and start-screen polish, and a small motion system with strict performance and
   accessibility rules. Same structure, same commands, same keyboard paths.
3. **Re-layout** (one-row header, a different shell, a new icon set). Larger visual change, but
   against the owner's "without changing the overall layout", rule 15 (icons) and D-36 (the
   ribbon's fit at 1280 px). Rejected as a whole; the one-row header was offered as optional item
   O3, and the owner accepted it (see the amendment below).

For the notices:

a. **Fix the service worker only.** The link works, but a 300 KB plain-text file in a tab is still
"basic".
b. **Fix the service worker and show the licenses inside About** (chosen): a searchable list
generated at build time and imported lazily (an app chunk, not a network call), plus the
`.txt` for download.

## Decision

**D-47 — Design language v2 (visual refresh, M10).** Within the existing layout (D-01) and
tokens (§8):

- Colours: cool slate neutrals and a blue brand `#2563eb` (owner's Q1 answer); in dark, a filled brand that keeps white text at AA and a lighter accent for
  lines and links. Every text pair at 4.5 : 1 and every control boundary and focus indicator at
  3 : 1, tested. Pages stay white, highlight and sticky-note defaults stay yellow, comment
  colours come from the standard swatch picker, and `forced-colors` hands colours to the system.
- Shape and depth: 6/8/12 px radii and layered elevation tokens; pressed toggles as a brand tint
  plus brand-coloured Filled icon (never tint alone); a focus ring with a soft halo on
  `:focus-visible`.
- Controls: one styled set of inputs, selects, check boxes, radios and switches, still native
  elements (keyboard and screen readers unchanged), native in `forced-colors`.
- **Motion:** 120 ms (hover, press), 180 ms (menus, tooltips, panes), 240 ms (dialogs,
  backstage), ease-out; only `opacity` and `transform`; **never** in the document view (pages,
  zoom, scrolling, drawing, dragging, measuring); all off under `prefers-reduced-motion`;
  nothing waits for an animation. A perf spec guards the animated surfaces (no long task,
  rule 1).
- Icons stay **Fluent System Icons** (ADR-010). Optional second-colour accents on a few tools
  (plan O1) use tokens only.

**Amendment (owner, 2026-11-16): all optional items accepted.** D-47 also covers:

- **One-row header (O3):** the product mark, Quick Access, File, the ribbon tabs and the top-bar
  buttons share one row above the ribbon panel (28 px more height for the document). Same
  commands, names and keyboard paths; the tab list scrolls inside its row when too narrow.
- **Bundled UI font (O8):** Inter (OFL-1.1, variable WOFF2, Latin subsets) self-hosted and in
  the core precache, with the system fonts as fallback; no font is fetched from anywhere else
  (rule 4).
- **Accent colour (O7)** and **density (O9)** in Settings → Appearance: Blue (default), Teal,
  Indigo, Graphite; Comfortable (default) or Compact. Stored on the device with the theme,
  applied before first paint, every accent contrast-tested in both themes, targets never below
  24 × 24 px. Accents never change comment colours, the yellow highlight and sticky-note
  defaults, or the white page.
- Icon accents (O1), loading placeholders (O5), command search (O2, search on Enter, rule 3)
  and "What's new" (O6) need no architecture change.

**D-49 — Create Blank PDF (O4).** File → New (and the start screen) creates a new document of a
chosen page size, orientation and page count in the Work worker (the `FPDF_CreateNewDocument`
route Merge uses) and opens it as an unsaved tab whose first save is a Save As.

**D-48 — About and open-source licenses.** File → About shows the product, version, build date
and commit, offline status, **Copy version info** (version, browser, OS only: no document data,
rule 10), links to Help, Report an issue and Privacy, a short "Built with" list of the main
components, and an in-app **Open-source licenses** view: every runtime package with its version,
license and full text, searchable, generated by `scripts/notices.ts` at build time and loaded as a
lazy app chunk (no network call, rule 4), with the `.txt` download kept. The service worker
returns `index.html` only for navigations to app routes and serves other same-origin files
(the notices `.txt`) as files, from its cache when offline.

### ARCHITECTURE.md changes (Rev 0.15, applied on acceptance)

- §2: add D-47 and D-48.
- §8: the Design tokens bullet gains "radius, elevation and **motion** tokens; motion only on
  opacity/transform, never in the document view, off under reduced motion (D-47)"; the File
  backstage list says "about (version, open-source licenses, D-48)".
- §9: the service worker answers navigations to app routes with `index.html` and serves other
  files as files (D-48).
- §13: add M10.

**Rev 0.16 (the amendment):** §2 D-47 extended and D-49 added; §3.2 adds the Inter font row; §8
top bar becomes one row with Quick Access and the tabs, and Appearance lists accent and density;
§7.8 gains Create Blank PDF; §10.3 lists the accent and density choices.

## Consequences

- Most of the work is CSS on existing tokens and components; no layout code moves, so the
  adaptive ribbon, keyboard paths and accessible names are unchanged. Each PR still re-checks the
  1280 px fit.
- The 51 Help screenshots go stale and are regenerated once at the end of M10.
- The licenses chunk adds about 300 KB to the background precache (not the 9 MB core); Inter
  adds about 100–300 KB to the core precache.
- The one-row header (O3) is the one layout change in M10, accepted by the owner; e2e locators
  and Help screenshots that rely on the old two-row banner are updated in its PR.
- Risk: e2e tests that read colours or box positions; mitigated by full-suite runs on the larger
  PRs and by disabling animation in position-measuring tests.

## Evidence

- Before screenshots of `main` (ab2edeb) at 1366 × 800, light and dark, and a rough CSS-only
  preview of the direction: the project's shared folder `m10-plan/before/` and
  `m10-plan/preview/` (not in the repository).
- Notices bug reproduced with Playwright against `npm run build` + `scripts/serve.ts`: after the
  service worker reported "Ready offline" and the page reloaded, File → About → Third-party
  notices opened `/third-party-notices.txt` showing the app (title "Triya PDF", the ribbon)
  instead of the text. `curl` of the same URL returns the 316 KB text (200, `text/plain`).
- Contrast (WCAG relative luminance): white on `#2563eb` 5.17 : 1; white on `#3b82f6` 3.68 : 1;
  `#1d4ed8` on `#dbeafe` 5.49 : 1; `#60a5fa` on `#0f172a` 7.02 : 1; `#64748b` on `#0f172a`
  3.75 : 1; white on `#0f6cbd` 5.38 : 1.
