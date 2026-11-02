// The user's own comment styles in memory (M6-07, D-37): loaded from
// IndexedDB once, changed by the Comment Styles Palette dialog and shown
// under the presets in each tool's palette (stylePalette.ts). Nothing here
// is logged (rule 10).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { appDb } from '../../../storage/appDb';
import {
  cleanName,
  COMMENT_STYLES_VERSION,
  MAX_STYLES,
  mergeStyles,
  migrateStyles,
  moveStyle,
  parseStyles,
  serializeStyles,
  type StoredCommentStyles,
  type StyleFileError,
  type UserStyle,
  type UserStyles,
} from './stylePalette';
import { cleanProps, isStyleTool, type StyleProps, type StyleTool } from './toolDefaults';

interface CommentStylesState {
  styles: UserStyles;
  loaded: boolean;
  /** The Comment Styles Palette dialog, and the tool it shows. */
  dialogOpen: boolean;
  dialogTool: StyleTool;
}

export const commentStylesStore = createStore<CommentStylesState>()(() => ({
  styles: {},
  loaded: false,
  dialogOpen: false,
  dialogTool: 'freeText',
}));

export function useCommentStyles<T>(selector: (s: CommentStylesState) => T): T {
  return useStore(commentStylesStore, selector);
}

const NONE: readonly UserStyle[] = [];

/** A tool's own styles, in the user's order. */
export const stylesOf = (s: CommentStylesState, tool: StyleTool): readonly UserStyle[] =>
  s.styles[tool] ?? NONE;

let loading: Promise<void> | null = null;

export function loadCommentStyles(): Promise<void> {
  loading ??= appDb()
    .then(async (db) => {
      const styles: UserStyles = {};
      for (const [tool, raw] of await db.listCommentStyles()) {
        if (!isStyleTool(tool)) continue;
        const list = migrateStyles(raw);
        if (list.length) styles[tool] = list;
      }
      commentStylesStore.setState((s) => ({
        // Anything changed while loading wins over what was stored.
        styles: { ...styles, ...s.styles },
        loaded: true,
      }));
    })
    .catch((err: unknown) => {
      recordError('commentStyles.load', err);
      commentStylesStore.setState({ loaded: true });
    });
  return loading;
}

async function persist(tool: StyleTool, list: readonly UserStyle[]): Promise<void> {
  try {
    const db = await appDb();
    if (list.length) {
      const rec: StoredCommentStyles = { v: COMMENT_STYLES_VERSION, styles: [...list] };
      await db.putCommentStyles(tool, rec);
    } else await db.deleteCommentStyles(tool);
  } catch (err) {
    recordError('commentStyles.save', err);
  }
}

function setList(tool: StyleTool, list: UserStyle[]): Promise<void> {
  commentStylesStore.setState((s) => ({ styles: { ...s.styles, [tool]: list } }));
  return persist(tool, list);
}

const current = (tool: StyleTool): readonly UserStyle[] =>
  stylesOf(commentStylesStore.getState(), tool);

/** Adds a style at the end; false when the name is empty, the props are, or the tool is full. */
export async function addStyle(
  tool: StyleTool,
  name: string,
  props: StyleProps,
  id: string,
): Promise<boolean> {
  const n = cleanName(name);
  const p = cleanProps(props);
  const list = current(tool);
  if (!n || Object.keys(p).length === 0 || list.length >= MAX_STYLES) return false;
  await setList(tool, [...list, { id, name: n, props: p }]);
  return true;
}

/** Renames a style; false when the name is empty or too long. */
export async function renameStyle(tool: StyleTool, id: string, name: string): Promise<boolean> {
  const n = cleanName(name);
  if (!n) return false;
  await setList(
    tool,
    current(tool).map((s) => (s.id === id ? { ...s, name: n } : s)),
  );
  return true;
}

export function deleteStyle(tool: StyleTool, id: string): Promise<void> {
  return setList(
    tool,
    current(tool).filter((s) => s.id !== id),
  );
}

/** Moves a style up (-1) or down (+1) in its tool's list. */
export function reorderStyle(tool: StyleTool, id: string, delta: -1 | 1): Promise<void> {
  return setList(tool, moveStyle(current(tool), id, delta));
}

/** The export file of every tool's styles. */
export const exportStylesFile = (): string => serializeStyles(commentStylesStore.getState().styles);

export type ImportResult = { ok: true; count: number } | { ok: false; errors: StyleFileError[] };

/** Imports a `.pdftools-styles.json` file: appended to each tool's styles, or refused whole. */
export async function importStylesFile(text: string, newId: () => string): Promise<ImportResult> {
  const parsed = parseStyles(text, newId);
  if (!parsed.ok) return parsed;
  const merged = mergeStyles(commentStylesStore.getState().styles, parsed.value.styles);
  if (!merged) return { ok: false, errors: ['tooMany'] };
  const changed = Object.keys(parsed.value.styles).filter(isStyleTool);
  commentStylesStore.setState({ styles: merged });
  await Promise.all(changed.map((tool) => persist(tool, merged[tool] ?? [])));
  return { ok: true, count: parsed.value.count };
}

export function openStylesDialog(tool?: StyleTool): void {
  void loadCommentStyles();
  commentStylesStore.setState((s) => ({ dialogOpen: true, dialogTool: tool ?? s.dialogTool }));
}

export function setDialogTool(tool: StyleTool): void {
  commentStylesStore.setState({ dialogTool: tool });
}

export function closeStylesDialog(): void {
  commentStylesStore.setState({ dialogOpen: false });
}

/** "Clear all local data" (the database is deleted separately). */
export function resetAllCommentStyles(): void {
  loading = null;
  commentStylesStore.setState({ styles: {}, loaded: false });
}
