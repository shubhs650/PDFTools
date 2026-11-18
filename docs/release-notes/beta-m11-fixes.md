# Triya PDF beta: what's new (November 2026, search, measuring and tab fixes)

Fixes from the pre-release bug check
([docs/acceptance/pre-release-bugs.md](../acceptance/pre-release-bugs.md)). Nothing moved: every
command is where it was.

## Search

- Closing the **Search** pane (or choosing another pane, or searching again) takes the highlight
  of the result you opened off the page.
- Search highlights sit on the right words on cropped pages and on pages whose boxes don't start
  at the page corner.
- After pages are deleted, rotated, inserted, moved or cropped, **Advanced Search** says the pages
  changed and asks you to search again, instead of "No results".
- Closing a file while **All open documents** are searched skips that file; the search goes on.
- The **Find** bar follows the selected tab: on another tab it starts afresh, and it closes when
  no document is left.
- Opening an Advanced Search result no longer replaces the words in the Find bar. **F3** and
  **Shift+F3** step through the result's hits; **Ctrl+F** starts the Find bar afresh.

## Drawing and measuring

- Choosing another tool or another tab drops a half-drawn Polyline, Polygon, Cloud, Perimeter or
  Area, as **Esc** does, with its live measurement value.
- The snap marker goes away when you choose another tool or tab.
- The tool you chose stays on when you switch tabs, as in desktop editors (unchanged).

## Bookmarks and files

- A bookmark whose page was deleted now says so instead of doing nothing.
- Opening a file that is already open under another name selects its tab and says which one.
