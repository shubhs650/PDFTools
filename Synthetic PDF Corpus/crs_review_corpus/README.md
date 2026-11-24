# CRS review corpus

Self-made review copies (CLAUDE.md rule 13) carrying review comments of every kind, as a checking
engineer leaves them, to check the Comment Resolution Sheet exports (Standard CRS and project
templates, M13-07, D-71) against. Every comment is a standard PDF annotation with an appearance
stream. Replies and review statuses are reply annotations, as desktop PDF editors write them.

Rebuild with `npm run corpus:crs`; never edit these files by hand. The generator is
`e2e/fixtures/crs-review/`.

| File                                   | Comments (CRS rows) | See-through (opacity < 70 %) | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :------------------------------------- | ------------------: | ---------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crs_01_steel_drawing_set_review.pdf`  |                  26 |                            3 | A3 steel drawing set, 4 sheets with page labels S-101 to S-104. S-101 carries most comment kinds (cloud, callout, arrow, rectangle, oval, note with special characters and a reply thread, typewriter text, polyline, pencil, stamp with no text, distance measurement, cloud with no text, polygon, a note with no author, a note without an appearance stream) and three see-through check highlights. Statuses: Accepted, Rejected, Completed, Cancelled, and none. S-102 has a long multi-line comment and blue markups; S-103 has no comments; S-104 is stored portrait with /Rotate 90. |
| `crs_02_pump_specification_review.pdf` |                  14 |                            1 | A4 pump specification, 3 pages, no page labels. Text markups on the words they comment on: highlights (one over two lines), underline, strikeout, inserted text (caret), squiggly; a margin note; on page 2 a callout pointing at a table cell, a rectangle round an empty table row, a text box and one see-through check highlight; on page 3 a note with no author, a cancelled note with a reply, and a stamp. Statuses: Accepted, Completed, Cancelled, and none.                                                                                                                        |

"Comments" counts the rows a CRS lists with every comment type ticked and "Ignore highlights" off;
with "Ignore highlights" on, the see-through ones are left out.
