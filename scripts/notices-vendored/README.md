# Vendored notice texts

License and notice files for runtime packages whose npm tarball ships none, copied verbatim from
the package's source repository at the pinned version. `scripts/notices.ts` uses them before
falling back to a standard license text.

| Package                             | Version      | Source                                                                                                                                                                                 | Why                                                                                                 |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pdf-oxide-wasm`                    | 0.3.77       | `github.com/yfedoseev/pdf_oxide` tag `v0.3.77`: `NOTICE`, `LICENSE-MIT`                                                                                                                | ADR-009 decision 7: ship the crate's NOTICE and the MIT text (M4-04)                                |
| `@embedpdf/default-signature-fonts` | 1.0.0-next.1 | `github.com/embedpdf/embed-pdf-viewer` `main` (2026-11-02): root `LICENSE` (Apache-2.0, the package's code); the package's own `licenses/*-OFL.txt` as `LICENSE.*-OFL.txt` (the fonts) | M6-13 (ADR-022 d3): the tarball keeps its texts in `licenses/`, which the notice scan does not read |

Update these files whenever the package version changes.
