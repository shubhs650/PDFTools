# S34 owner check — the measurement interop pack

**File:** `Synthetic PDF Corpus/measure/interop/S34_interop_pack.pdf`. It has three pages and 42
markups, all self-made. **Viewers:** Adobe Acrobat Reader, the second desktop PDF editor you used for
the FDF exports, and the PDF viewer in Chrome or Edge.

The red and blue markups are the measurements. Black and grey lines are the drawing.

## What to do in each viewer

Use a fresh copy of the file for each viewer, and do not save over the original.

1. **Looks right.** Every red or blue measurement shows its value, as in the pictures
   (`viewer-p*.png`). The Slab and End plate have white holes. The Office diagonal has a gap
   in the line where its value sits.
2. **Selects as one item.** Click the value text, then the line or symbol. Both clicks select the
   same single item. Nothing is left behind as a separate text box.
3. **Moves as one item, and keeps its look.** Drag it a little. The value, the arrows and the
   leader lines move together, and the value is still shown after the move. This is the most important
   check.
4. **Deletes as one item.** Delete it. Nothing of it stays on the page. Undo afterwards.
5. **Value readable.** Find it in the comments list. Its text is the value ("24,000 mm",
   "Door 3", "∠ 142.5°"), and its subject is the tool ("Length", "Count").

Chrome and Edge cannot select or move these markups, so only checks 1 and 5 apply there (check 5 only
if the viewer shows a comments list).

## The items

`P` = proposal (what the tools would save), `A` = alternative, kept only for comparison.

| #   | Page | Item                                                             | Saved as                           |
| --- | ---- | ---------------------------------------------------------------- | ---------------------------------- |
| 1   | 1    | Length 24,000 mm, below the plan, with leader lines (Above)      | P: Line                            |
| 2   | 1    | Length 10,817 mm, the Office diagonal (In line)                  | P: Line                            |
| 3   | 1    | Polylength 23,000 mm (wall run along the bottom and right walls) | P: PolyLine                        |
| 4   | 1    | Perimeter "Office: 30,000 mm"                                    | P: PolyLine                        |
| 5   | 1    | Area "Workshop: 114.00 m²"                                       | P: Polygon                         |
| 6   | 1    | Volume "Slab S1: 17.69 m³", two holes                            | P: Polygon                         |
| 7   | 1    | Count "Door 1" … "Door 7" (blue circles)                         | P: Stamp                           |
| 8   | 1    | Summary table, top right                                         | P: FreeText                        |
| 9   | 2    | Polylength "Line 150-P-101: 15,000 mm"                           | P: PolyLine                        |
| 10  | 2    | Angles ∠ 142.5° and ∠ 37.5°                                      | P: Stamp                           |
| 11  | 2    | Radius R 1,200 mm on the bend; R 300 mm on the flange            | P: Stamp                           |
| 12  | 2    | Diameter Ø 3,000 mm across the tank                              | P: Stamp                           |
| 13  | 2    | Counts in five symbols (Support, Valve, Drain, Weld, Checked)    | P: Stamp                           |
| 14  | 3    | Lengths "Beam B1: 8,000 mm" (1:50), 400 mm (1:5), 900 mm (1:10)  | P: Line                            |
| 15  | 3    | Cutout "End plate: 0.0985 m²", four bolt holes                   | P: Polygon                         |
| 16  | 3    | Angle ∠ 59.1° (top right)                                        | A: PolyLine                        |
| 17  | 3    | Counts "Door 8", "Valve 3"                                       | A: Square                          |
| 18  | 3    | Radius R 706 mm, two arcs                                        | A: Circle (left), PolyLine (right) |
| 19  | 3    | Diameter Ø 1,058 mm (small circle, top right)                    | A: Circle                          |
| 20  | 3    | Distance 5,500 mm as version 1.1.0 saved it                      | Line + grouped text (old)          |

Item 20 is the old two-part Distance. It is expected to select as two items in some editors. It
is in the pack for the "Update old measurements" bar (M14-03).

## How to report

One line per viewer is enough, for example: "Acrobat: all fine except 3, 4, 9: value disappears
after a move". The answers that decide the design:

- **Do items 1–6, 9, 14 and 15 keep their value after a move** in Acrobat Reader and the second editor?
  If an editor redraws them and drops the value, the value stays in the comments list. We then
  decide together whether that is acceptable.
- **Are Stamps acceptable for Angle, Radius, Diameter and Count** (items 7, 10–13)? A Stamp always
  keeps its look. Compare them with the alternatives 16–19: move one of each and see which one
  still looks right.
- Anything that looks wrong, prints wrong, or leaves pieces behind.
