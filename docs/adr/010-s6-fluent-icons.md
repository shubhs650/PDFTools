# ADR-010: S6 — Fluent icon coverage for the ribbon; icon style and custom icons

- **Status:** Proposed. Decisions 1–3 need owner approval; decision 1 changes D-20 and CLAUDE.md
  rule 15.
- **Date:** 2026-09-24
- **Deciders:** Owner (pending); recorded by the coding agent
- **Related decisions:** D-20, D-30, D-12 (ARCHITECTURE.md §8, §8.2, §3.2); ADR-001 B6; CLAUDE.md
  rules 5, 12 and 15
- **Related spike / milestone:** M0-S6 (feeds the M1 ribbon)
- **Outcome (spikes only):** **Fails as specified, works with workaround.** Fluent's **Color**
  style covers only **24 of 126** commands (19 %), and upstream marks every Color icon
  **deprecated** for accessibility reasons. The **Regular** style covers **all 126**. The proposal
  is Regular throughout, Filled for active states, and 23 custom icons drawn in the same style.

## Context

D-20 and §8 call for Fluent UI System Icons in the **Color** style, with missing engineering icons
drawn to match. S6 has to map every Rev 0 ribbon command to an icon, list the custom icons, and
measure the bundle cost. See
[M0 plan §S6](../plan/M0.md#s6--fluent-color-icon-coverage-for-the-ribbon-list-of-custom-icons-required).

## Setup

- **Package:** `@fluentui/react-icons` 2.0.341 (MIT). It adds `@griffel/react` (MIT) and `tslib`
  (0BSD). `npm run licenses` passes (536 packages).
- **Inventory:** `spikes/s6-icons/commands.ts` lists 126 commands:
  - the quick access toolbar and the §8 tabs File, Home, View, Comment, Measure, Organize, Convert,
    Protect and Help;
  - the §5 left-rail panes and status bar.

  It is built from §5–§8. Out-of-scope commands are omitted (ADR-001 B6). `docs/ui-reference/`
  was used for grouping only, and no PDF-XChange artwork is referenced (rule 15).

- **Catalog:** `catalog.ts` reads the installed package's per-icon type files. It found 2,897 base
  icons.
- **Size rule:** small buttons, panes and the status bar use the 20 px glyph. Large ribbon buttons
  (32 px, §8) use the native 32 px glyph, or the largest of 28 and 24 px, scaled up.
- **Outputs:**
  - the generated map, [`docs/plan/S6-icon-map.md`](../plan/S6-icon-map.md);
  - a bundle measurement (`bundle.ts`);
  - a visual preview sheet (`out/s6-preview.html`, Regular next to Color);
  - 4 unit tests.

## Findings

1. **Color coverage is thin.** Only 199 of 2,897 base icons have a Color variant, and they lean
   towards Office and Teams concepts (people, calendar, chat, mail).
   - Only **24 of 126** commands can use Color, and 6 of those are custom anyway.
   - There is no Color icon for Save, Print, Open, Undo/Redo, Zoom, Rotate, Highlight, any
     drawing or markup tool, Stamp, Ruler, Table or Redaction.
   - A ribbon that mixes the two styles looks inconsistent. In the preview, Recent, Settings and
     Privacy are in blue Color, next to monochrome Save, Print and zoom.
2. **Color icons are deprecated upstream.** Every `*Color` export carries `@deprecated`, and the
   package README advises against them:
   - they don't follow Windows High Contrast Mode (they ignore `forced-colors`);
   - their SVG gradient IDs are global, so hiding one instance breaks the others unless each
     instance gets an `idPrefix`;
   - they fail WCAG contrast in dark themes.

   All three conflict with D-30 (baseline accessibility), rule 12, and §8's requirement that
   tokens support a dark theme.

3. **Regular covers everything.** All 126 commands have a suitable Regular glyph at 20 px, and at
   24 px or more for large buttons. **Filled** also exists for all 126, which suits active and
   toggled states. Regular and Filled use `currentColor`, so design tokens and forced-colors mode
   work without extra code.
4. **32 px glyphs are often missing.** Of the 50 large buttons:
   - 25 have a native 32 px Regular glyph;
   - 8 top out at 28 px;
   - 17 top out at 24 px.

   Scaling 24 → 32 thickens the strokes by 1.33×. In the preview this looks acceptable but a little
   heavier than native 32 px icons.

5. **Custom icons: 23.** Fluent has no suitable glyph for these, even in Regular. The Fluent glyph
   listed is the interim fallback.

   | Group   | Custom icons                                                                                                                   |
   | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
   | §8 list | revision **cloud**, **calibrate**, **scale viewport**, **CRS export**                                                          |
   | Measure | perimeter, area, set scale (Fluent `Scales` is a weighing balance), snapping, 4 CAD snap markers                               |
   | Comment | squiggly, replace text, **stamp**                                                                                              |
   | Protect | mark for redaction, mark area, apply redactions                                                                                |
   | Other   | save optimized, continuous facing, loupe, pan-and-zoom window, to Word (a "DOCX" document: no Word logo, which is a trademark) |

   `Stamp` exists only in Fluent's separate Light style, at 32 px. **Express extract**, listed as
   custom in §8, fits Fluent's `TableLightning`, so it isn't custom unless the owner prefers one.

6. **Bundle cost is small and tree-shakes.** Minified, with React external:

   | Variant                                   | Raw     | gzip    | brotli      |
   | ----------------------------------------- | ------- | ------- | ----------- |
   | Runtime + 1 icon (baseline)               | 17.4 kB | 6.3 kB  | 5.6 kB      |
   | 156 Regular glyphs, root import           | 82.5 kB | 26.1 kB | **22.1 kB** |
   | 156 Regular glyphs, per-icon path imports | 82.5 kB | 26.1 kB | 22.1 kB     |
   | Color where available, Regular otherwise  | 127 kB  | 30.8 kB | 25.3 kB     |

   Both import styles tree-shake to the same output. Path imports
   (`@fluentui/react-icons/svg/<icon>`) built in 0.2 s against 0.6–0.9 s for the root barrel, which
   matters for dev-server startup. The installed package is 174 MB on disk; it is dev and CI disk
   only, and never shipped.

7. **CSP.** The icons style themselves through Griffel, which injects `<style>` rules at runtime.
   §10.1's `style-src 'self' 'unsafe-inline'` already allows this. S8's CSP checks will cover it
   once the M1 shell renders icons.

## Options considered

1. **Color where it exists, Regular elsewhere** (D-20 as written).
   - For: some colour on about a fifth of the buttons.
   - Against: an inconsistent ribbon; a deprecated API; High Contrast, dark-theme and ID-collision
     problems; and each Color icon has to be bundled with a Filled twin for forced-colors mode.
2. **Draw our own Color versions** of the ~100 missing icons.
   - For: a consistent, colourful ribbon.
   - Against: a large art effort, the same accessibility problems, and ongoing maintenance.
     Rejected.
3. **Regular throughout, Filled for active and toggled states, custom icons in the same line
   style.** Colour comes from design tokens through `currentColor`. For example, a markup tool's
   icon can show the current annotation colour.
   - For: 100 % coverage and a consistent look; High Contrast and dark themes work for free; not
     deprecated.
   - Against: a more monochrome look than PDF-XChange or Office.
4. **Option 3 plus two-tone accents.** Layer the Filled glyph in an accent token at low opacity
   under the Regular glyph, as the package README describes, on a few large buttons.
   - For: some warmth without Color icons.
   - Against: two glyphs per icon. Forced-colors mode must drop the accent layer.

## Decision (proposed)

1. _(Owner)_ **Adopt option 3**, allowing option 4 later if wanted. This amends:
   - D-20: "Fluent UI System Icons (MIT), Color style" becomes "**Regular** style (Filled for
     active states)";
   - §8 "Icons: Fluent System Icons Color style" to match;
   - CLAUDE.md rule 15: "Fluent UI System Icons (Color)" becomes "(Regular)".

   These are edited only after this ADR is accepted.

2. _(Owner)_ **Large buttons** use the native 32 px glyph when it exists, otherwise the 28 or 24 px
   glyph scaled to 32 px. The owner can check the preview sheet. The alternative is a 24 px glyph
   in a 32 px slot for all large buttons, which gives consistent stroke weight but smaller icons.
3. _(Owner)_ **Custom list:** the 23 icons in finding 5, drawn on Fluent's 20, 24 and 32 px
   grids in the Regular line style (`currentColor`, matching Fluent's stroke weights). Express extract uses
   `TableLightning`.
4. **Icon registry in `/src/ui/icons`:**
   - one module that maps command ids to components;
   - Fluent icons imported by path (`@fluentui/react-icons/svg/<icon>`), never from the root
     barrel;
   - `commands.ts` becomes the seed of the ribbon command table;
   - the S6 test that checks every command id resolves to an existing glyph moves to `/tests`.
5. **Accessibility:** icons are decorative (`aria-hidden`). Every button's accessible name comes
   from its i18n label (rules 11 and 12).

## Consequences

- **M1:** the ribbon, rail and status bar use the registry. Custom icons ship as small React SVG
  components in the same API shape (`FluentIcon`-compatible props).
- **Budget:** about 22 kB brotli for the icon set plus 5.6 kB of runtime, which is negligible
  against §9's 60 MB.
- **Owner:**
  - open `spikes/s6-icons/out/s6-preview.html` (regenerate it with the commands below) to judge
    decisions 1–2;
  - confirm the custom list.
- **Risks:**
  - Fluent renames or removes icons between versions. The registry test catches that on every
    dependency bump.
  - Custom icons drift from Fluent's style. Draw them on Fluent's published grid and keyline
    templates, and review them next to their neighbours in the preview sheet.

## Evidence

- Code: [`spikes/s6-icons/`](../../spikes/s6-icons/)
  - `commands.ts` (inventory) and `catalog.ts` (catalog and size resolution), with 4 tests in
    `catalog.test.ts`;
  - `bundle.ts` (bundle cost) and `icon-map.ts` (map document and preview sheet).
- Map: [`docs/plan/S6-icon-map.md`](../plan/S6-icon-map.md)
- Commands:
  - `node spikes/s6-icons/bundle.ts && node spikes/s6-icons/icon-map.ts`: writes the map,
    `out/s6-bundle.json`, `out/s6-map.json` and `out/s6-preview.html`;
  - `npx vitest run spikes/s6-icons`.
