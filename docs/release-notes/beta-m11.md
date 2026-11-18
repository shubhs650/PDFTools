# Triya PDF beta: what's new (November 2026, tabs, fonts and picking up where you left off)

Better file tabs, a library of fonts for text comments, comments you can pick up with any tool,
and eight everyday features beta users asked about: pick up where you left off, each file's last
view, a selected-text menu, Zoom to Area, copying pictures, Images to PDF, Split Document and Crop
Pages. Nothing moved: every command is where it was.

## Pick up where you left off

- **File › Settings › Start-up › When Triya PDF starts**: **Show the start screen** (as before)
  or **Reopen the files from last time**. With the second, the files that were open when you
  left open again in their tabs, in the same order, with the same tab selected, each at the
  page and zoom you left it at.
- Browsers usually ask again before a web app may open your files after they restart. Files
  they ask about wait on the start screen under **Pick up where you left off**: choose
  **Reopen** and allow access, or **Not now**. Files the browser still allows open at once.
- New documents that were never saved and files saved to your downloads can't be reopened. A
  file with unsaved changes is offered in **Recover unsaved changes?** instead, so you get your
  changes back.
- Only the files' names and the browser's permission handles are kept, on this device, and
  only while **Reopen the files from last time** is chosen (listed in **File › Privacy**,
  deleted by **Clear all local data**). Needs Chrome or Edge on a computer, as Recent files.

## Each file's last view

- A file opens again at the page, zoom, layout and view rotation you left it at, even after you
  saved changes to it.

## Document tabs

- The selected tab stands out in the accent colour; resting on a tab shows its first page, full
  name, where it came from, pages, size, last change and whether it has unsaved changes.
- **+** after the last tab (or a double-click on the empty strip) opens files.
- Drag a tab to reorder; Ctrl+Shift+Left/Right moves it with the keyboard; the middle button
  closes it.
- Right-click a tab for Save, Close, Close Other Tabs, Close Tabs to the Right, Close All Tabs,
  Reopen Closed Tab, Move Left/Right, Sort Tabs by Name, Copy File Name, Rename File and Document
  Properties.

## Selecting, comments and text

- Text recognised with OCR can be selected and copied straight away.
- Comments can be selected and moved with Hand and Select Text too; right-clicking a comment
  always opens its menu.
- Right-click selected text for Copy, Highlight, Underline, Strikeout, Squiggly, Mark for
  Redaction and Search.

## Fonts in text comments

- Text boxes, typewriter text and callouts can use a **library of 26 font families** that ships
  with the app and works offline: Office-compatible fonts with the same widths as Arial, Times
  New Roman, Courier New and Calibri, sans and narrow fonts, technical and drawing fonts, serif,
  monospaced and handwriting fonts, and Hindi (Devanagari) and Chinese.
- The font list shows each name in its own face, groups the fonts, keeps your **Recently used**
  fonts at the top, and jumps to a name as you type it.
- The font is embedded in the saved file (only the letters used), so Acrobat Reader, PDF-XChange
  and other readers show the comment as you wrote it. Symbols such as ⌀, °, ± and Ω are drawn even when a font lacks them.
- Only the fonts that come with Triya PDF are offered, so a comment looks the same on every
  computer. Tell us which fonts you miss and we may add them in a later version.
- Form fields keep the three standard fonts for now.

## Viewing

- The Properties pane can be resized like the left pane, and arrows on the pane edges hide or
  show either pane.
- **View › Zoom to Area**: drag a rectangle and it fills the window (or hold Z while using Hand).
- Right-click a picture on the page to copy it or save it as a PNG at its own resolution.

## Images to PDF

- Open (Ctrl+O) or drop **JPG and PNG files**, such as site photos or scans, and **Images to
  PDF** lists them: put them in order, then choose the page size. **Fit each page to its image**
  uses the size the image states (96 dpi when it states none); **A4** and **Letter** turn to
  suit each image (landscape for a wide photo), with an optional 10 mm margin, and never enlarge
  an image. The new PDF opens in its own tab; save it to choose where it goes.
- **Organize › Insert from Image** adds images as pages to the open document, before or after
  a page, as one undo step. **Organize › Images to PDF** and **File › New** start an empty list.
- Photos taken with the phone turned show upright (the camera's EXIF orientation is applied).
  JPEGs go into the PDF as they are, without re-compression; transparent parts of a PNG stay
  transparent.

## Split Document

- **Organize › Split Document** saves parts of the open document as separate PDFs: **every few
  pages**, **by page ranges** (such as `1-5, 6-12, 13-`, one file per range) or **by top-level
  bookmarks** (each file from its bookmark to the page before the next; pages before the first
  bookmark go into the first file). The dialog lists the file names before you split.
- The files go into a folder you choose, named after the document with their pages or their
  bookmark, and never replace a file already there. Where the browser can't save into a folder,
  they come in one ZIP file. Your unsaved changes go into the files; the open document is not
  changed.

## Crop Pages

- **Organize › Crop Pages** cuts margins off pages: type the top, bottom, left and right margins
  in mm or inches, as the page is shown, for all pages, the current page, the selected pages or a
  range. A preview outlines the area kept, and the dialog says the new page size.
- **Organize › Crop Tool**: drag a rectangle around the part of a page to keep; Crop Pages opens
  with its margins, for that page (change the pages there).
- Only the page's crop box changes (one undo step): the content stays in the file, other PDF
  readers show the page cropped too, and **Remove Crop** shows the whole page again.
  Measurements and scales keep their values on a cropped page.
