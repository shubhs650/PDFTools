# Measure corpus (self-made)

Synthetic drawings with known true values for the measuring tools (M14, D-79). Built by `e2e/fixtures/measure-corpus/` (spike S34, M14-01); rebuild with `npm run corpus:measure`, never edit by hand. Tests read them through `e2e/fixtures/measure-corpus/index.ts`.

`MEASURE_MANIFEST.json` lists, for every sheet, its scale areas and the items to measure: the points to click in PDF user space (points, origin bottom-left, before `/Rotate`), and the true value. Values come from the drawing geometry, not from reading the PDF.

## 01_floor_plan_1-100_mm.pdf

Floor plan 1:100 (mm). Page /VP "Plan" at 1:100 in mm; the 24000 dimension can calibrate too.

| Item             | Tool       | True value   | Note                                        |
| :--------------- | :--------- | :----------- | :------------------------------------------ |
| overall-length   | length     | 24000 mm     | Grid A to D along the bottom wall           |
| office-diagonal  | length     | 10816.654 mm | Office corner to corner                     |
| wall-run         | polylength | 23000 mm     | Open path along the east walls              |
| office-perimeter | perimeter  | 30000 mm     | Closed: the closing side counts             |
| office-area      | area       | 54 m²        | 9000 x 6000                                 |
| workshop-area    | area       | 114 m²       | L-shaped room                               |
| slab-net-area    | cutout     | 70.75 m²     | 81 m² gross minus 2.25 m² and 8 m² openings |
| slab-volume      | volume     | 17.6875 m³   | Net slab area x 250 mm (gross: 20.25 m³)    |
| doors            | count      | 7 doors      | Hinge points of the seven doors             |

## 02_pipe_run_1-50.pdf

Pipe run with bends 1:50 (mm). Page /VP "Pipe run" at 1:50 in mm.

| Item           | Tool       | True value | Note                                                            |
| :------------- | :--------- | :--------- | :-------------------------------------------------------------- |
| run-length     | polylength | 15000 mm   | Centreline through the intersection points (6000 + 5000 + 4000) |
| first-leg      | length     | 6000 mm    | Dimensioned leg                                                 |
| inside-angle-B | angle      | 142.5 °    | Inside angle at the first bend                                  |
| deflection-B   | angle      | 37.5 °     | Deflection from the horizontal construction line                |
| bend-radius-B  | radius     | 1200 mm    | Bend radius (an arc, not a full circle)                         |
| tank-diameter  | diameter   | 3000 mm    | Tank T-1                                                        |
| flange-radius  | radius     | 300 mm     | Flange, a small full circle                                     |

## 03_three_scales_1-50_1-5_1-10.pdf

One sheet, three scales (1:50, 1:5, 1:10). Three /VP entries; the rest of the page has no scale.

| Item             | Tool   | True value | Note                                                              |
| :--------------- | :----- | :--------- | :---------------------------------------------------------------- |
| beam-length      | length | 8000 mm    | Top of beam, end to end                                           |
| plate-width      | length | 400 mm     | End plate width at 1:5                                            |
| plate-area       | area   | 0.1 m²     | 400 x 250 at 1:5                                                  |
| cleat-length     | length | 900 mm     | Cleat length at 1:10                                              |
| spans-two-scales | length | none mm    | Starts in Main view, ends in Detail A: no value, "spans 2 scales" |

## 04_no_scale.pdf

No scale (sketch). No /VP: the first measurement asks for a scale (D-77).

| Item            | Tool   | True value       | Note                    |
| :-------------- | :----- | :--------------- | :---------------------- |
| paper-line      | length | 100 mm (paper)   | Measured at paper size  |
| paper-rectangle | area   | 4000 mm² (paper) | 80 x 50 mm on paper     |
| paper-angle     | angle  | 104.036 °        | An angle needs no scale |

## 05_raster_only.pdf

Raster only (one image, no vectors). No /VP and nothing to snap to: calibrate on the 10 m scale bar.

| Item        | Tool        | True value | Note                                                       |
| :---------- | :---------- | :--------- | :--------------------------------------------------------- |
| scale-bar   | calibration | 10000 mm   | Calibrate on the 10 m scale bar (no vectors to snap to)    |
| room-area   | area        | 72 m²      | 12000 x 6000 at 1:100 (line centres, 0.5 mm wide on paper) |
| room-length | length      | 12000 mm   | Bottom wall centreline                                     |

## 06_imperial_ft-in.pdf

Imperial, ft-in (1/4" = 1'-0"). /VP "Plan" in feet shown as ft-in to 1/16".

| Item        | Tool   | True value | Note            |
| :---------- | :----- | :--------- | :-------------- |
| long-wall   | length | 240 in     | 20'-0"          |
| odd-length  | length | 97.5 in    | 8'-1 1/2"       |
| garage-area | area   | 250 sq ft  | 20'-0" x 12'-6" |

## 07_rotated_page.pdf

Rotated page (/Rotate 90). Portrait media box, /Rotate 90; points are in user space (before the turn).

| Item           | Tool   | True value | Note                                    |
| :------------- | :----- | :--------- | :-------------------------------------- |
| overall-length | length | 24000 mm   | Same wall as sheet 01, on a turned page |
| office-area    | area   | 54 m²      | 9000 x 6000                             |
| slab-net-area  | cutout | 70.75 m²   | As sheet 01                             |
