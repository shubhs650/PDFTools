// The comment styles in memory (M6-07, D-37; M6-17): each tool's Custom
// Styles — the presets and the user's own, one ordered list — loaded from
// IndexedDB once, changed by the Comment Styles Palette window and shown in
// each tool's ribbon palette (stylePalette.ts). Nothing here is logged (rule 10).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { appDb } from '../../../storage/appDb';
import {
  cleanName,
  COMMENT_STYLES_VERSION,
  insertAfter,
  MAX_STYLES,
  mergeStyles,
  migrateStyles,
  moveStyle,
  parseStyles,
  PALETTE_TOOLS,
  resetStyle as resetOne,
  restorePresets,
  seedStyles,
  serializeStyles,
  type StoredCommentStyles,
  type StyleFileError,
  type UserStyle,
  type UserStyles,
} from './stylePalette';
import { cleanProps, isStyleTool, type StyleProps, type StyleTool } from './toolDefaults';
import { resetToolDefaults } from './toolDefaultsStore';

interface CommentStylesState {
  styles: UserStyles;
  loaded: boolean;
  /** The Comment Styles Palette window, and the tool it shows. */
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

/** Each tool's presets, made once (a stable list for selectors). */
const SEEDS = new Map<StyleTool, readonly UserStyle[]>();
const seedOf = (tool: StyleTool): readonly UserStyle[] => {
  let list = SEEDS.get(tool);
  if (!list) {
    list = seedStyles(tool);
    SEEDS.set(tool, list);
  }
  return list;
};

/** A tool's Custom Styles in the user's order (its presets until anything is stored). */
export const stylesOf = (s: CommentStylesState, tool: StyleTool): readonly UserStyle[] =>
  s.styles[tool] ?? seedOf(tool);

let loading: Promise<void> | null = null;

export function loadCommentStyles(): Promise<void> {
  loading ??= appDb()
    .then(async (db) => {
      const styles: UserStyles = {};
      for (const [tool, raw] of await db.listCommentStyles()) {
        if (!isStyleTool(tool)) continue;
        // v1 records are rewritten as v2 the next time the tool's styles change.
        styles[tool] = migrateStyles(raw, tool);
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
    // Stored even when empty: a tool whose presets were all deleted stays so.
    const rec: StoredCommentStyles = { v: COMMENT_STYLES_VERSION, styles: [...list] };
    await db.putCommentStyles(tool, rec);
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

/**
 * Adds a style right after the style `after` (null: at the end); false when
 * the name is empty or too long, the props are empty, or the tool is full.
 */
export async function addStyle(
  tool: StyleTool,
  name: string,
  props: StyleProps,
  id: string,
  after: string | null = null,
): Promise<boolean> {
  const n = cleanName(name);
  const p = cleanProps(props);
  const list = current(tool);
  if (!n || Object.keys(p).length === 0 || list.length >= MAX_STYLES) return false;
  await setList(tool, insertAfter(list, after, { id, name: n, props: p }));
  return true;
}

/** Replaces a style's properties (the window's property grid); false when they are empty. */
export async function updateStyle(
  tool: StyleTool,
  id: string,
  props: StyleProps,
): Promise<boolean> {
  const p = cleanProps(props);
  if (Object.keys(p).length === 0) return false;
  await setList(
    tool,
    current(tool).map((s) => (s.id === id ? { ...s, props: p } : s)),
  );
  return true;
}

/** Reset: a preset back to its own look and name. */
export function resetStyle(tool: StyleTool, id: string): Promise<void> {
  return setList(
    tool,
    current(tool).map((s) => (s.id === id ? resetOne(tool, s) : s)),
  );
}

/**
 * Reset All (M6-17): every tool's current style back to the shipped default
 * and its presets as shipped; the user's own styles are kept.
 */
export async function resetAllStyles(): Promise<void> {
  await Promise.all(
    PALETTE_TOOLS.map(async (tool) => {
      await resetToolDefaults(tool);
      await setList(tool, restorePresets(tool, current(tool)));
    }),
  );
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

/** The export file of every tool's styles (`nameOf`: a style's shown name). */
export const exportStylesFile = (nameOf: (tool: StyleTool, style: UserStyle) => string): string =>
  serializeStyles(commentStylesStore.getState().styles, nameOf);

export type ImportResult = { ok: true; count: number } | { ok: false; errors: StyleFileError[] };

/** Imports a `.pdftools-styles.json` file: appended to each tool's styles, or refused whole. */
export async function importStylesFile(text: string, newId: () => string): Promise<ImportResult> {
  const parsed = parseStyles(text, newId);
  if (!parsed.ok) return parsed;
  const merged = mergeStyles(current, parsed.value.styles);
  if (!merged) return { ok: false, errors: ['tooMany'] };
  const changed = Object.keys(parsed.value.styles).filter(isStyleTool);
  commentStylesStore.setState((s) => ({ styles: { ...s.styles, ...merged } }));
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
