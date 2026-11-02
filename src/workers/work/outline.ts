// Our own outline reader and writer (M6-11, §7.15, ADR-022 decision 5, route
// B; prototyped in spikes/s18-s22-m6/s21-bookmarks.ts). The engine's
// setBookmarks rebuilds the whole outline and loses colour, style and open
// state, and stops half-way on actions it can't write; here every item keeps
// every key it had. The outline is read from the document's current state
// (original + saved tail + live section), the edit is applied to that tree,
// and only the objects whose content changed are written: an existing item
// keeps its object number (a rename writes one object), a new one gets the
// next free number; the catalog is written only when it gains an outline
// root. The Render worker applies the objects with the reopen route
// (`pagesApply`), and Ctrl+S saves them in the narrow tail. Strings are
// encrypted for an encrypted document (the reader's key), as comment transfer
// does. Pure apart from reading.
import {
  PdfActionType,
  PdfZoomMode,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from '@embedpdf/models';
import {
  isDict,
  nameOf,
  PdfName,
  PdfRef,
  PdfString,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../model/pdf/objects';
import type { PdfReader } from '../../model/pdf/reader';
import { fromJson, toJson } from '../../model/pdf/wire';
import {
  MAX_TITLE,
  within,
  type ClipItem,
  type DestSpec,
  type ItemProps,
  type NewItem,
  type OutlineEdit,
  type OutlineExpect,
  type OutlineItem,
  type OutlinePath,
  type Rgb,
} from '../../model/outline';
import type { ExtraObject } from '../render/save/narrowTail';

/** Deeper outlines are cut there (a cycle or a hostile file, never a stack overflow). */
const MAX_DEPTH = 64;
/** More items than this are not read (a hostile file). */
const MAX_ITEMS = 200_000;
/** The keys that make the tree: rewritten by the writer, never copied. */
const LINK_KEYS = ['Parent', 'Prev', 'Next', 'First', 'Last', 'Count'] as const;

export class OutlineError extends Error {
  readonly code: 'bookmark-stale' | 'bookmark-invalid';
  constructor(code: 'bookmark-stale' | 'bookmark-invalid', message: string) {
    super(message);
    this.code = code;
  }
}

/** One outline item as read: its object, its dictionary (decrypted) and its children. */
export interface Node {
  /** Object number (null: new, or a direct dictionary in a malformed file). */
  num: number | null;
  gen: number;
  dict: PdfDict;
  /** The dictionary as read (null: new): an item whose content is the same is not written. */
  orig: PdfDict | null;
  kids: Node[];
}

export interface OutlineTree {
  catalogNum: number;
  catalogGen: number;
  catalog: PdfDict;
  /** The outline root's object (null: the document has none yet). */
  rootNum: number | null;
  rootGen: number;
  root: PdfDict | null;
  nodes: Node[];
}

const genOf = (reader: PdfReader, num: number): number => {
  const e = reader.xref.get(num);
  return e?.type === 1 ? e.gen : 0;
};

/** The outline tree of the document `reader` reads (cycles and non-dictionaries skipped). */
export async function readTree(reader: PdfReader): Promise<OutlineTree> {
  const catRef = reader.trailer.get('Root');
  if (!(catRef instanceof PdfRef)) throw new Error('no catalog');
  const catalog = await reader.get(catRef);
  if (!isDict(catalog)) throw new Error('no catalog');
  const tree: OutlineTree = {
    catalogNum: catRef.num,
    catalogGen: genOf(reader, catRef.num),
    catalog,
    rootNum: null,
    rootGen: 0,
    root: null,
    nodes: [],
  };
  const rootRef = catalog.get('Outlines');
  const root = await reader.resolve(rootRef);
  if (!isDict(root)) return tree;
  if (rootRef instanceof PdfRef) {
    tree.rootNum = rootRef.num;
    tree.rootGen = genOf(reader, rootRef.num);
  }
  tree.root = root;
  const seen = new Set<number>(rootRef instanceof PdfRef ? [rootRef.num] : []);
  let items = 0;
  const readList = async (first: PdfValue | undefined, depth: number): Promise<Node[]> => {
    const out: Node[] = [];
    if (depth > MAX_DEPTH) return out;
    let cur = first;
    while (cur !== undefined && cur !== null && items < MAX_ITEMS) {
      let num: number | null = null;
      if (cur instanceof PdfRef) {
        if (seen.has(cur.num)) break;
        seen.add(cur.num);
        num = cur.num;
      }
      const d = await reader.resolve(cur);
      if (!isDict(d)) break;
      items++;
      out.push({
        num,
        gen: num === null ? 0 : genOf(reader, num),
        dict: d,
        orig: num === null ? null : d,
        kids: await readList(d.get('First'), depth + 1),
      });
      cur = d.get('Next');
    }
    return out;
  };
  tree.nodes = await readList(root.get('First'), 1);
  return tree;
}

// ------------------------------------------------------------------ reading for the pane

/** Destination lookups: page objects and named destinations, built when first needed. */
export class DestResolver {
  private pageIndex: Map<number, number> | null = null;
  private pageRefs: PdfRef[] = [];
  private named: Map<string, PdfValue> | null = null;

  private readonly reader: PdfReader;

  constructor(reader: PdfReader) {
    this.reader = reader;
  }

  async pages(): Promise<PdfRef[]> {
    if (!this.pageIndex) {
      const pages = await this.reader.pages();
      this.pageRefs = pages.map((p) => new PdfRef(p.num, genOf(this.reader, p.num)));
      this.pageIndex = new Map(pages.map((p, i) => [p.num, i]));
    }
    return this.pageRefs;
  }

  private async indexOf(ref: PdfValue | undefined): Promise<number> {
    await this.pages();
    if (ref instanceof PdfRef) return this.pageIndex?.get(ref.num) ?? -1;
    return -1;
  }

  /** Named destinations: the catalog's /Dests (PDF 1.1) and the /Names /Dests name tree. */
  private async names(): Promise<Map<string, PdfValue>> {
    if (this.named) return this.named;
    const named = new Map<string, PdfValue>();
    this.named = named;
    const r = this.reader;
    const catalog = await r.resolve(r.trailer.get('Root'));
    if (!isDict(catalog)) return named;
    const old = await r.resolve(catalog.get('Dests'));
    if (isDict(old)) for (const [k, v] of old) named.set(k, v);
    const names = await r.resolve(catalog.get('Names'));
    const top = isDict(names) ? names.get('Dests') : undefined;
    const seen = new Set<number>();
    const walk = async (ref: PdfValue | undefined, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return;
      if (ref instanceof PdfRef) {
        if (seen.has(ref.num)) return;
        seen.add(ref.num);
      }
      const node = await r.resolve(ref);
      if (!isDict(node)) return;
      const list = await r.resolve(node.get('Names'));
      if (Array.isArray(list))
        for (let i = 0; i + 1 < list.length; i += 2) {
          const k = list[i];
          if (k instanceof PdfString && !named.has(k.text()))
            named.set(k.text(), list[i + 1] ?? null);
        }
      const kids = await r.resolve(node.get('Kids'));
      if (Array.isArray(kids)) for (const k of kids) await walk(k, depth + 1);
    };
    await walk(top, 1);
    return named;
  }

  /** A /Dest value (array, name, string, or a dictionary with /D) as EmbedPDF's model. */
  async destination(v: PdfValue | undefined, depth = 0): Promise<PdfDestinationObject | null> {
    if (depth > 4) return null;
    const val = await this.reader.resolve(v);
    if (val instanceof PdfName || val instanceof PdfString) {
      const key = val instanceof PdfName ? val.name : val.text();
      return this.destination((await this.names()).get(key), depth + 1);
    }
    if (isDict(val)) return this.destination(val.get('D'), depth + 1);
    if (!Array.isArray(val)) return null;
    const pageIndex = await this.indexOf(val[0]);
    const mode = nameOf(val[1]);
    const nums = await Promise.all(val.slice(2).map((x) => this.reader.resolve(x)));
    const n = (i: number): number => {
      const x = nums[i];
      return typeof x === 'number' && Number.isFinite(x) ? x : 0;
    };
    const view = nums.map((_, i) => n(i));
    switch (mode) {
      case 'XYZ':
        return {
          pageIndex,
          zoom: { mode: PdfZoomMode.XYZ, params: { x: n(0), y: n(1), zoom: n(2) } },
          view: [],
        };
      case 'Fit':
        return { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view: [] };
      case 'FitH':
        return { pageIndex, zoom: { mode: PdfZoomMode.FitHorizontal }, view };
      case 'FitV':
        return { pageIndex, zoom: { mode: PdfZoomMode.FitVertical }, view };
      case 'FitR':
        return { pageIndex, zoom: { mode: PdfZoomMode.FitRectangle }, view };
      case 'FitB':
        return { pageIndex, zoom: { mode: PdfZoomMode.FitBoundingBox }, view: [] };
      case 'FitBH':
        return { pageIndex, zoom: { mode: PdfZoomMode.FitBoundingBoxHorizontal }, view };
      case 'FitBV':
        return { pageIndex, zoom: { mode: PdfZoomMode.FitBoundingBoxVertical }, view };
      default:
        return { pageIndex, zoom: { mode: PdfZoomMode.Unknown }, view: [] };
    }
  }

  /** An item's target and action type (/Dest first, else /A). */
  async target(
    dict: PdfDict,
  ): Promise<{ target: PdfLinkTarget | undefined; action: string | null }> {
    if (dict.has('Dest')) {
      const destination = await this.destination(dict.get('Dest'));
      return {
        target: destination ? { type: 'destination', destination } : undefined,
        action: null,
      };
    }
    const a = await this.reader.resolve(dict.get('A'));
    if (!isDict(a)) return { target: undefined, action: null };
    const s = nameOf(a.get('S')) ?? '';
    if (s === 'GoTo') {
      const destination = await this.destination(a.get('D'));
      return {
        target: destination
          ? { type: 'action', action: { type: PdfActionType.Goto, destination } }
          : undefined,
        action: s,
      };
    }
    if (s === 'URI') {
      const u = await this.reader.resolve(a.get('URI'));
      const uri = u instanceof PdfString ? u.text() : '';
      return { target: { type: 'action', action: { type: PdfActionType.URI, uri } }, action: s };
    }
    return { target: { type: 'action', action: { type: PdfActionType.Unsupported } }, action: s };
  }
}

const textOf = async (reader: PdfReader, v: PdfValue | undefined): Promise<string> => {
  const s = await reader.resolve(v);
  return s instanceof PdfString ? s.text() : '';
};

async function colorOf(reader: PdfReader, v: PdfValue | undefined): Promise<Rgb | null> {
  const c = await reader.resolve(v);
  if (!Array.isArray(c) || c.length !== 3) return null;
  const rgb = c.map((x) => (typeof x === 'number' ? Math.min(1, Math.max(0, x)) : 0)) as Rgb;
  return rgb.every((x) => x === 0) ? null : rgb;
}

/** The outline as the pane shows it. */
export async function readOutline(reader: PdfReader): Promise<OutlineItem[]> {
  const tree = await readTree(reader);
  const dests = new DestResolver(reader);
  const view = async (nodes: Node[]): Promise<OutlineItem[]> => {
    const out: OutlineItem[] = [];
    for (const n of nodes) {
      const flags = await reader.resolve(n.dict.get('F'));
      const f = typeof flags === 'number' ? flags : 0;
      const count = await reader.resolve(n.dict.get('Count'));
      out.push({
        title: await textOf(reader, n.dict.get('Title')),
        ...(await dests.target(n.dict)),
        color: await colorOf(reader, n.dict.get('C')),
        italic: (f & 1) !== 0,
        bold: (f & 2) !== 0,
        open: typeof count === 'number' && count > 0 && n.kids.length > 0,
        children: await view(n.kids),
      });
    }
    return out;
  };
  return view(tree.nodes);
}

// ------------------------------------------------------------------ editing (pure)

const nodeAt = (nodes: Node[], path: readonly number[]): Node | null => {
  let list = nodes;
  let cur: Node | null = null;
  for (const i of path) {
    cur = list[i] ?? null;
    if (!cur) return null;
    list = cur.kids;
  }
  return cur;
};

/** The list `parent` holds its children in (the top level for []). */
const listAt = (nodes: Node[], parent: readonly number[]): Node[] | null =>
  parent.length === 0 ? nodes : (nodeAt(nodes, parent)?.kids ?? null);

const without = (d: PdfDict, keys: readonly string[]): PdfDict => {
  const out = new Map(d);
  for (const k of keys) out.delete(k);
  return out;
};

const titleOf = (d: PdfDict): string => {
  const t = d.get('Title');
  return t instanceof PdfString ? t.text() : '';
};

/** Refuses an edit whose paths no longer hold the titles the pane showed. */
export function checkExpect(nodes: Node[], expect: readonly OutlineExpect[]): void {
  for (const e of expect) {
    const n = nodeAt(nodes, e.path);
    if (!n || titleOf(n.dict) !== e.title)
      throw new OutlineError('bookmark-stale', 'The bookmarks changed since they were shown');
  }
}

/** A destination array for `spec` (its page must exist). */
export function destArray(spec: DestSpec, pages: readonly PdfRef[]): PdfValue[] {
  const page = pages[spec.page];
  if (!page) throw new OutlineError('bookmark-invalid', 'No such page');
  const num = (v: number | null): number | null =>
    v === null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;
  switch (spec.fit) {
    case 'fit':
      return [page, new PdfName('Fit')];
    case 'fitH':
      return [page, new PdfName('FitH'), num(spec.top)];
    default:
      return [page, new PdfName('XYZ'), num(spec.left), num(spec.top), num(spec.zoom)];
  }
}

const cleanTitle = (t: string): string => t.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TITLE);

/** Sets the props on a copy of `d`. */
function withProps(d: PdfDict, props: ItemProps, pages: readonly PdfRef[]): PdfDict {
  const out = new Map(d);
  if (props.title !== undefined) out.set('Title', PdfString.of(cleanTitle(props.title)));
  if (props.dest !== undefined) {
    // A destination replaces whatever the bookmark did (an action included).
    out.delete('A');
    out.set('Dest', destArray(props.dest, pages));
  }
  if (props.color !== undefined) {
    if (props.color === null || props.color.every((c) => c === 0)) out.delete('C');
    else
      out.set(
        'C',
        props.color.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 1000) / 1000),
      );
  }
  if (props.bold !== undefined || props.italic !== undefined) {
    const old = d.get('F');
    let f = typeof old === 'number' ? old : 0;
    if (props.italic !== undefined) f = props.italic ? f | 1 : f & ~1;
    if (props.bold !== undefined) f = props.bold ? f | 2 : f & ~2;
    if (f === 0) out.delete('F');
    else out.set('F', f);
  }
  return out;
}

function fromClip(c: ClipItem): Node {
  const d = fromJson(c.dict);
  if (!isDict(d)) throw new OutlineError('bookmark-invalid', 'Not a bookmark');
  // The open state comes along (its sign); the other links are the writer's.
  const dict = without(
    d,
    LINK_KEYS.filter((k) => k !== 'Count'),
  );
  return { num: null, gen: 0, dict, orig: null, kids: c.children.map(fromClip) };
}

function newNode(item: NewItem, pages: readonly PdfRef[]): Node {
  if ('clip' in item) return fromClip(item.clip);
  const dict: PdfDict = new Map([['Title', PdfString.of(cleanTitle(item.title))]]);
  if (item.dest) dict.set('Dest', destArray(item.dest, pages));
  return { num: null, gen: 0, dict, orig: null, kids: [] };
}

/** Applies `edit` to `nodes` in place. */
export function applyEdit(nodes: Node[], edit: OutlineEdit, pages: readonly PdfRef[]): void {
  const bad = (what: string): never => {
    throw new OutlineError('bookmark-invalid', what);
  };
  switch (edit.kind) {
    case 'insert': {
      const list = listAt(nodes, edit.parent) ?? bad('No such bookmark');
      if (edit.index < 0 || edit.index > list.length) bad('Bad position');
      list.splice(edit.index, 0, ...edit.items.map((i) => newNode(i, pages)));
      return;
    }
    case 'update': {
      const n = nodeAt(nodes, edit.path) ?? bad('No such bookmark');
      n.dict = withProps(n.dict, edit.props, pages);
      return;
    }
    case 'remove': {
      const parent = edit.path.slice(0, -1);
      const i = edit.path.at(-1) ?? bad('No such bookmark');
      const list = listAt(nodes, parent) ?? bad('No such bookmark');
      const n = list[i] ?? bad('No such bookmark');
      if (edit.mode === 'all') list.splice(i, 1);
      else if (edit.mode === 'keepChildren') list.splice(i, 1, ...n.kids);
      else n.kids = [];
      return;
    }
    case 'move': {
      if (within(edit.parent, edit.path)) bad('A bookmark cannot go inside itself');
      const from = edit.path.slice(0, -1);
      const i = edit.path.at(-1) ?? bad('No such bookmark');
      const src = listAt(nodes, from) ?? bad('No such bookmark');
      const dst = listAt(nodes, edit.parent) ?? bad('No such bookmark');
      if (edit.index < 0 || edit.index > dst.length) bad('Bad position');
      const [n] = src.splice(i, 1);
      if (!n) return bad('No such bookmark');
      const at = src === dst && edit.index > i ? edit.index - 1 : edit.index;
      dst.splice(at, 0, n);
      return;
    }
  }
}

/** Copied bookmarks (Copy / Cut) as plain data. */
export function clipOf(nodes: Node[], paths: readonly OutlinePath[]): ClipItem[] {
  const clip = (n: Node): ClipItem => ({
    dict: toJson(
      without(
        n.dict,
        LINK_KEYS.filter((k) => k !== 'Count'),
      ),
    ),
    children: n.kids.map(clip),
  });
  return paths.map((p) => {
    const n = nodeAt(nodes, p);
    if (!n) throw new OutlineError('bookmark-stale', 'The bookmarks changed since they were shown');
    return clip(n);
  });
}

// ------------------------------------------------------------------ writing

/** Same keys and values, in any order (the writer re-adds the links last). */
const sameDict = (a: PdfDict, b: PdfDict): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined || serialize(v) !== serialize(w)) return false;
  }
  return true;
};

export interface WriteDeps {
  /** The first free object number. */
  next: number;
  /** Encrypts the strings of an object for an encrypted document (null: plain). */
  encrypt: ((v: PdfValue, num: number, gen: number) => PdfValue) | null;
}

/**
 * The objects that make `tree` (as edited) on disk: changed and new items, the
 * root when its links changed, the catalog when it gains a root.
 */
export function writeTree(
  tree: OutlineTree,
  deps: WriteDeps,
): { objects: ExtraObject[]; firstNew: number } {
  let next = deps.next;
  const firstNew = next;
  const objects: ExtraObject[] = [];
  const emit = (num: number, gen: number, d: PdfDict): void => {
    const v = deps.encrypt ? deps.encrypt(d, num, gen) : d;
    objects.push({ num, gen, bytes: serializeIndirect(num, gen, v) });
  };
  // Numbers first (a parent links its children's numbers and theirs back).
  const assign = (list: Node[]): void => {
    for (const n of list) {
      if (n.num === null) {
        n.num = next++;
        n.gen = 0;
      }
      assign(n.kids);
    }
  };
  const rootNum = tree.rootNum ?? next++;
  const rootGen = tree.rootNum === null ? 0 : tree.rootGen;
  assign(tree.nodes);
  const ref = (n: number, g = 0) => new PdfRef(n, g);
  /** Writes `list` under `parent`; returns how many items are visible below an open parent. */
  const write = (list: Node[], parent: PdfRef): number => {
    let visible = 0;
    list.forEach((n, i) => {
      const num = n.num ?? 0;
      const d = without(n.dict, LINK_KEYS);
      d.set('Parent', parent);
      const prev = list[i - 1];
      const nxt = list[i + 1];
      if (prev) d.set('Prev', ref(prev.num ?? 0, prev.gen));
      if (nxt) d.set('Next', ref(nxt.num ?? 0, nxt.gen));
      visible++;
      if (n.kids.length) {
        const first = n.kids[0];
        const last = n.kids[n.kids.length - 1];
        if (first) d.set('First', ref(first.num ?? 0, first.gen));
        if (last) d.set('Last', ref(last.num ?? 0, last.gen));
        const below = write(n.kids, ref(num, n.gen));
        // The item keeps its open / closed state (the sign of its old /Count).
        const was = n.dict.get('Count');
        const closed = typeof was === 'number' && was < 0;
        d.set('Count', closed ? -below : below);
        if (!closed) visible += below;
      }
      // An item whose dictionary comes out as it was read is not written.
      if (!n.orig || !sameDict(n.orig, d)) emit(num, n.gen, d);
    });
    return visible;
  };
  const visible = write(tree.nodes, ref(rootNum, rootGen));
  const root: PdfDict = without(tree.root ?? new Map<string, PdfValue>(), [
    'First',
    'Last',
    'Count',
  ]);
  if (!root.has('Type')) root.set('Type', new PdfName('Outlines'));
  const first = tree.nodes[0];
  const last = tree.nodes[tree.nodes.length - 1];
  if (first) root.set('First', ref(first.num ?? 0, first.gen));
  if (last) root.set('Last', ref(last.num ?? 0, last.gen));
  if (tree.nodes.length) root.set('Count', visible);
  if (!tree.root || !sameDict(tree.root, root)) emit(rootNum, rootGen, root);
  if (tree.rootNum === null) {
    const cat = new Map(tree.catalog);
    cat.set('Outlines', ref(rootNum, rootGen));
    emit(tree.catalogNum, tree.catalogGen, cat);
  }
  return { objects, firstNew };
}

/**
 * One edit on the document `reader` reads (its current state): the objects to
 * write and the first number allocated (the Render worker refuses a stale state).
 */
export async function editObjects(
  reader: PdfReader,
  edit: OutlineEdit,
  expect: readonly OutlineExpect[],
): Promise<{ objects: ExtraObject[]; firstNew: number }> {
  const tree = await readTree(reader);
  checkExpect(tree.nodes, expect);
  applyEdit(tree.nodes, edit, await new DestResolver(reader).pages());
  let next = reader.maxObjNum();
  for (const k of reader.xref.keys()) next = Math.max(next, k + 1);
  const crypt = reader.crypt;
  return writeTree(tree, {
    next,
    encrypt: crypt ? (v, num, gen) => crypt.mapStrings(v, num, gen, true) : null,
  });
}

/** Copy / Cut: the bookmarks at `paths` with every key. */
export async function copyItems(
  reader: PdfReader,
  paths: readonly OutlinePath[],
  expect: readonly OutlineExpect[],
): Promise<ClipItem[]> {
  const tree = await readTree(reader);
  checkExpect(tree.nodes, expect);
  return clipOf(tree.nodes, paths);
}
