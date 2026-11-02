// The Bookmarks pane's commands (M6-11, §7.15): its toolbar, its context menu
// and its keys (scope "bookmarks" in the keymap) all run these, on the
// focused bookmark of the active document. Every edit is one undo step and
// needs the modify permission (rule 9).
import { registerCommand, type CommandHandler } from '../../app/commands/dispatch';
import { msg, t, type MessageKey } from '../../i18n';
import { pathKey, type OutlineEdit, type OutlinePath } from '../../model/outline';
import { followTarget } from '../view/links';
import {
  activeDoc,
  bookmarksStore,
  collapseAll,
  copyBookmarks,
  editBlocked,
  expandAll,
  focused,
  itemsOf,
  openProperties,
  runEdit,
  startRename,
} from './bookmarks';
import { currentDest } from './currentDest';
import { focusAfterDelete, moveTarget, nudgeEdit, type Nudge } from './outlineEdit';

const parentOf = (p: OutlinePath): OutlinePath => p.slice(0, -1);
const last = (p: OutlinePath): number => p[p.length - 1] ?? 0;

/** Needs a focused bookmark (and, for an edit, an editable outline). */
function needFocus(edit: boolean): MessageKey | null {
  const docId = activeDoc();
  if (!docId) return msg('bookmarks.notReady');
  if (!itemsOf(docId)) return msg('bookmarks.notReady');
  if (!focused()) return msg('bookmarks.noneSelected');
  return edit ? editBlocked(docId) : null;
}

/** Where new and pasted bookmarks go: after the focused one, else at the end. */
function insertPlace(docId: string): { parent: OutlinePath; index: number } {
  const f = focused();
  if (f) return { parent: parentOf(f.path), index: last(f.path) + 1 };
  return { parent: [], index: itemsOf(docId)?.length ?? 0 };
}

async function newBookmark(child: boolean): Promise<void> {
  const docId = activeDoc();
  if (!docId) return;
  const f = focused();
  const place = child && f ? { parent: f.path, index: f.item.children.length } : insertPlace(docId);
  const edit: OutlineEdit = {
    kind: 'insert',
    ...place,
    items: [{ title: t('bookmarks.untitled'), dest: currentDest(docId) }],
  };
  await runEdit(docId, edit, msg('bookmarks.editing'), {
    focus: [...place.parent, place.index],
    rename: true,
    expand: place.parent.length ? [place.parent] : [],
  });
}

async function remove(mode: 'all' | 'keepChildren' | 'onlyChildren'): Promise<void> {
  const f = focused();
  const items = f ? itemsOf(f.docId) : null;
  if (!f || !items) return;
  await runEdit(f.docId, { kind: 'remove', path: f.path, mode }, msg('bookmarks.editing'), {
    // Its first child moves into its place; else the next one, the one above, the parent.
    focus:
      mode === 'onlyChildren' || (mode === 'keepChildren' && f.item.children.length)
        ? f.path
        : focusAfterDelete(items, f.path),
  });
}

async function paste(): Promise<void> {
  const docId = activeDoc();
  const clip = bookmarksStore.getState().clip;
  if (!docId || clip?.docId !== docId) return;
  const place = insertPlace(docId);
  await runEdit(
    docId,
    { kind: 'insert', ...place, items: clip.items.map((c) => ({ clip: c })) },
    msg('bookmarks.editing'),
    { focus: [...place.parent, place.index] },
  );
}

export async function nudge(how: Nudge): Promise<boolean> {
  const f = focused();
  const items = f ? itemsOf(f.docId) : null;
  if (!f || !items) return false;
  const edit = nudgeEdit(items, f.path, how);
  if (edit?.kind !== 'move') return false;
  const to = moveTarget(edit);
  return runEdit(f.docId, edit, msg('bookmarks.editing'), {
    focus: [...to.parent, to.index],
    expand: to.parent.length ? [to.parent] : [],
  });
}

function nudgeBlocked(how: Nudge): MessageKey | null {
  const why = needFocus(true);
  if (why) return why;
  const f = focused();
  const items = f ? itemsOf(f.docId) : null;
  return f && items && nudgeEdit(items, f.path, how) ? null : msg('bookmarks.cannotMove');
}

export function registerBookmarkCommands(): () => void {
  const handlers: [string, CommandHandler][] = [
    [
      'bookmark.goTo',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(false),
        run: () => {
          followTarget(focused()?.item.target);
        },
      },
    ],
    [
      'bookmark.new',
      {
        requiresDocument: true,
        disabledReason: () => {
          const docId = activeDoc();
          return docId ? editBlocked(docId) : msg('bookmarks.notReady');
        },
        run: () => newBookmark(false),
      },
    ],
    [
      'bookmark.newChild',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(true),
        run: () => newBookmark(true),
      },
    ],
    [
      'bookmark.copy',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(false),
        run: async () => {
          const f = focused();
          if (f) await copyBookmarks(f.docId, [f.path]);
        },
      },
    ],
    [
      'bookmark.cut',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(true),
        run: async () => {
          const f = focused();
          if (f && (await copyBookmarks(f.docId, [f.path]))) await remove('all');
        },
      },
    ],
    [
      'bookmark.paste',
      {
        requiresDocument: true,
        disabledReason: () => {
          const docId = activeDoc();
          if (!docId) return msg('bookmarks.notReady');
          if (bookmarksStore.getState().clip?.docId !== docId)
            return msg('bookmarks.nothingToPaste');
          return editBlocked(docId);
        },
        run: paste,
      },
    ],
    [
      'bookmark.delete',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(true),
        run: () => remove('all'),
      },
    ],
    [
      'bookmark.deleteKeepChildren',
      {
        requiresDocument: true,
        disabledReason: () =>
          needFocus(true) ?? (focused()?.item.children.length ? null : msg('bookmarks.noChildren')),
        run: () => remove('keepChildren'),
      },
    ],
    [
      'bookmark.deleteChildren',
      {
        requiresDocument: true,
        disabledReason: () =>
          needFocus(true) ?? (focused()?.item.children.length ? null : msg('bookmarks.noChildren')),
        run: () => remove('onlyChildren'),
      },
    ],
    [
      'bookmark.expandAll',
      {
        requiresDocument: true,
        disabledReason: () => {
          const docId = activeDoc();
          return docId && itemsOf(docId)?.length ? null : msg('bookmarks.notReady');
        },
        run: () => {
          const docId = activeDoc();
          if (docId) expandAll(docId);
        },
      },
    ],
    [
      'bookmark.collapseAll',
      {
        requiresDocument: true,
        disabledReason: () => {
          const docId = activeDoc();
          return docId && itemsOf(docId)?.length ? null : msg('bookmarks.notReady');
        },
        run: () => {
          const docId = activeDoc();
          if (docId) collapseAll(docId);
        },
      },
    ],
    [
      'bookmark.rename',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(true),
        run: () => {
          const f = focused();
          if (f) startRename(f.docId, pathKey(f.path));
        },
      },
    ],
    [
      'bookmark.setDestination',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(true),
        run: async () => {
          const f = focused();
          const dest = f ? currentDest(f.docId) : null;
          if (f && dest)
            await runEdit(
              f.docId,
              { kind: 'update', path: f.path, props: { dest } },
              msg('bookmarks.editing'),
            );
        },
      },
    ],
    [
      'bookmark.properties',
      {
        requiresDocument: true,
        disabledReason: () => needFocus(false),
        run: () => {
          const f = focused();
          if (f) openProperties(f.docId, pathKey(f.path));
        },
      },
    ],
    ...(
      [
        ['bookmark.moveUp', 'up'],
        ['bookmark.moveDown', 'down'],
        ['bookmark.promote', 'promote'],
        ['bookmark.demote', 'demote'],
      ] as const
    ).map(([id, how]): [string, CommandHandler] => [
      id,
      {
        requiresDocument: true,
        disabledReason: () => nudgeBlocked(how),
        run: async () => {
          await nudge(how);
        },
      },
    ]),
  ];
  const offs = handlers.map(([id, h]) => registerCommand(id, h));
  return () => {
    for (const off of offs) off();
  };
}
