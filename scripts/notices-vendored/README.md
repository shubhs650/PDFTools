# Vendored notice texts

License and notice files for runtime packages whose npm tarball ships none, copied verbatim from
the package's source repository at the pinned version. `scripts/notices.ts` uses them before
falling back to a standard license text.

| Package          | Version | Source                                                                  | Why                                                                  |
| ---------------- | ------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pdf-oxide-wasm` | 0.3.77  | `github.com/yfedoseev/pdf_oxide` tag `v0.3.77`: `NOTICE`, `LICENSE-MIT` | ADR-009 decision 7: ship the crate's NOTICE and the MIT text (M4-04) |

Update these files whenever the package version changes.
