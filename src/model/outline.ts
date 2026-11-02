// Bookmark editing (M6-11, §7.15, ADR-022 decision 5, route B): what the
// Bookmarks pane shows and the edits it asks the Work worker for. Plain data,
// so it crosses the worker boundary as is. Items are addressed by their index
// path in the outline as last read ([2, 0] = the first child of the third
// top-level bookmark); every edit names the titles it expects at its paths,
// so an edit made on an outline that changed since is refused, never applied
// to the wrong bookmark.
import type { PdfLinkTarget } from '@embedpdf/models';
import type { PdfJson } from './pdf/wire';

/** Index path from the top level ([] = the outline root). */
export type OutlinePath = number[];

export type Rgb = [number, number, number];

export interface OutlineItem {
  title: string;
  /** Where it goes (EmbedPDF's model, so the view follows it like a link); undefined: nowhere. */
  target: PdfLinkTarget | undefined;
  /** The action's type (/S) when the bookmark runs one: shown in Properties. */
  action: string | null;
  /** /C (0–1); null: the default (black). */
  color: Rgb | null;
  bold: boolean;
  italic: boolean;
  /** Open in the file (/Count > 0): the pane shows it expanded at first. */
  open: boolean;
  children: OutlineItem[];
}

/** A destination the user sets (Set Destination, New Bookmark, Properties). */
export type DestSpec =
  | {
      /** 0-based page index. */
      page: number;
      fit: 'xyz';
      /** PDF user space; null keeps the viewer's. */
      left: number | null;
      top: number | null;
      /** 1 = 100 %; null keeps the viewer's zoom. */
      zoom: number | null;
    }
  | { page: number; fit: 'fit' }
  | { page: number; fit: 'fitH'; top: number | null };

/** What Properties, Rename and Set Destination change (absent keys stay). */
export interface ItemProps {
  title?: string;
  dest?: DestSpec;
  color?: Rgb | null;
  bold?: boolean;
  italic?: boolean;
}

/** Copied bookmarks (Copy / Cut): every key of each item but the tree links. */
export interface ClipItem {
  dict: PdfJson;
  children: ClipItem[];
}

export type NewItem = { title: string; dest: DestSpec | null } | { clip: ClipItem };

export type RemoveMode = 'all' | 'keepChildren' | 'onlyChildren';

export type OutlineEdit =
  | { kind: 'insert'; parent: OutlinePath; index: number; items: NewItem[] }
  | { kind: 'update'; path: OutlinePath; props: ItemProps }
  | { kind: 'remove'; path: OutlinePath; mode: RemoveMode }
  /** `index`: the position in `parent`'s list before the item is taken out. */
  | { kind: 'move'; path: OutlinePath; parent: OutlinePath; index: number };

/** The titles the edit expects at its paths (as last read). */
export interface OutlineExpect {
  path: OutlinePath;
  title: string;
}

/** Bookmark titles are capped (a pasted novel is not a bookmark). */
export const MAX_TITLE = 1000;

export const pathKey = (p: readonly number[]): string => p.join('.');

export const keyPath = (k: string): OutlinePath => (k === '' ? [] : k.split('.').map(Number));

/** The item at `path`, or null. */
export function itemAt(items: readonly OutlineItem[], path: readonly number[]): OutlineItem | null {
  let list = items;
  let cur: OutlineItem | null = null;
  for (const i of path) {
    cur = list[i] ?? null;
    if (!cur) return null;
    list = cur.children;
  }
  return cur;
}

/** Number of items in the outline. */
export const countItems = (items: readonly OutlineItem[]): number =>
  items.reduce((n, b) => n + 1 + countItems(b.children), 0);

/** `inner` is `outer` or lies inside it. */
export const within = (inner: readonly number[], outer: readonly number[]): boolean =>
  inner.length >= outer.length && outer.every((v, i) => inner[i] === v);
