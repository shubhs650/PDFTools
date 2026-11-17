# Triya PDF beta: what's new (November 2026, look and feel)

A fresher look inside the same layout, plus Tell me, blank PDFs and a richer About. Nothing moved:
every command is where it was.

## About and open-source licenses

- **File › About** shows the version, the commit and the date it was built, and whether this
  computer is ready to work offline.
- **Copy version info** puts the version, commit, build date, browser, operating system and the
  offline state on the clipboard, ready to paste into a bug report. Nothing from your documents
  is included.
- **Built with** lists the main components Triya PDF is made of (EmbedPDF, PDFium, PDF Oxide,
  Tesseract, Fluent UI System Icons, the Noto fonts and more), each with its license and version.
- **Open-source licenses** lists every package in the app with its version, license and full
  license text. Search it with Enter or the Search button. It works offline.
- **Third-party notices (opens in a new tab)** opens the notices again. Before, once the app was
  ready offline, it opened a second copy of the app instead. You can also download the notices as
  a text file.
- Buttons for **Help**, **Report an issue on GitHub** and **Privacy** are at the top of About.

## New colours

- A fresher look in both themes: cool slate greys instead of flat greys, and a brighter blue.
  The dark theme is a deep navy with the same blue for filled buttons and a lighter blue for
  lines and links. Every text and control colour still meets WCAG AA contrast.
- The area around the pages is lighter in the light theme. Pages stay white, highlights and
  sticky notes stay yellow, and comment colours are unchanged.
- The icon on blue buttons (such as **Open…**) is now white like its label, instead of grey.
- A blue button that can't be used yet (such as **Search** with an empty box) now looks
  disabled, instead of a blue button with grey text.
- Keyboard focus shows a soft blue halo around the focus ring.
- Windows High Contrast: the **File** tab and the File menu's list are readable again (their
  labels showed as blank boxes).

## One font everywhere

- Triya PDF now uses its own interface font, **Inter**, on Windows, macOS and Linux, so the app
  looks the same on every computer. The font comes with the app and works offline; nothing is
  downloaded from anywhere else.
- Text in languages Inter doesn't cover (such as Greek, Cyrillic, Chinese, Japanese, Korean,
  Arabic or Hebrew) still uses your computer's own fonts.
- Your PDFs are not affected: pages show the fonts in the document as before.

## Accent colour and density

- **File › Settings › Appearance** has an **Accent colour**: Blue (the default), Teal, Indigo or
  Graphite. It colours buttons, the current tab, selections and focus. Comment colours,
  highlights, sticky notes and pages never change with it.
- **Density**: Comfortable (the default) or **Compact**, which fits more rows in panes, lists,
  menus and dialogs and tightens the ribbon. Compact is also on **View › Window**.
- Both are kept on this computer, like the theme, and **Clear all local data** resets them.

## One row at the top

- The product name, Quick Access (Open, Save, Print, Undo, Redo), **File**, the tabs and the
  top-bar buttons now share one row, so the document gets more height.

## Ribbon

- The ribbon is a soft card. Tabs are rounded, and a short marker slides to the current one.
- A pressed tool shows a soft blue tint with a blue icon; a command you can't use yet is greyed.
- Key tools have a coloured icon so they are easy to find: Highlight and Sticky Note (amber),
  Sign Document and Signatures (green), OCR, To Word and Express Extract (violet), and the
  redaction tools (red).

## Forms and controls

- Check boxes, radio buttons, text boxes and lists look the same everywhere and follow the
  accent colour. Text areas (such as Send Error Report) show all their lines again.

## Start screen

- With no document open, a card to drop or open a PDF, quick actions (Create blank PDF, Merge
  files, Getting started, Keyboard shortcuts) and your recent files. The empty document-tab strip
  is hidden until a file is open.
- Dragging files over the window highlights where they will drop.

## Create a blank PDF

- **File › New**, the start screen's **Create blank PDF**, or **Ctrl+Alt+N**: choose A4, A3,
  Letter, Legal or a custom size, the orientation and the number of pages. It opens as
  "Untitled 1.pdf"; the first **Ctrl+S** asks where to save it.

## Panes, File menu, dialogs and status bar

- Panes have one header style and soft rounded rows; thumbnails show the current page clearly.
- The File menu is a calm column with the current page marked; Settings shows its groups as cards.
- Dialogs have rounder corners, and long dialogs (such as Print) keep their buttons in view.
- The status bar groups page navigation, zoom and view modes; "Ready offline" is a small green pill.

## Motion and loading

- Menus, dialogs, the File menu and panes open with short, calm animations. There is no animation
  in the document itself, and none at all when your system asks for reduced motion.
- Pages and thumbnails show a soft placeholder while they load, instead of blank white.
- Fixed: drawings with a very heavy first page now get their thumbnails, and a page could
  sometimes show half drawn.

## Tell me

- **Alt+Q** (or the lightbulb at the top right) opens a search box for commands. Type what you
  want to do and press **Enter**: it lists matching commands with where they live and their
  shortcut. Press **Enter** again to run the first one, or pick another with the arrow keys.

## What's new

- **File › About** now lists what's new in each version, newest first. After an update, a small
  card at the bottom right says so once; **See what's new** opens this list.
