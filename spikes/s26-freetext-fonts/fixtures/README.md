# Spike S26 test fonts

Small subsets of Google Fonts files, made by `make-fixtures.ts` from the library faces that
`build-library.ts` builds (pinned to one instance, cut to the characters of `cases.ts` plus
printable ASCII). Test data only; not shipped. All are under the SIL Open Font License 1.1
([OFL.txt](OFL.txt), with each family's copyright line).

| File                       | Family (Google Fonts `ofl/…`)                   |
| -------------------------- | ----------------------------------------------- |
| `roboto-*.ttf`             | Roboto (`ofl/roboto`), wght 400 and 700         |
| `tinos-regular.ttf`        | Tinos (`ofl/tinos`)                             |
| `notosansdeva-regular.ttf` | Noto Sans Devanagari (`ofl/notosansdevanagari`) |
| `notosansmath-regular.ttf` | Noto Sans Math (`ofl/notosansmath`)             |
| `notosanssc-regular.ttf`   | Noto Sans SC (`ofl/notosanssc`), wght 400       |

None of these families reserves its name (Noto Sans SC reserves "Source", which it does not
use). The CFF Noto Sans CJK SC case is cut at test time from `@embedpdf/fonts-sc`, because that
license reserves "Noto Sans" for unmodified copies.
