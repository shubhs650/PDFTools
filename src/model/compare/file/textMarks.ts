// A text comparison file's change marks (M12-20, D-65, ADR-032 decision 2),
// worked out from the text comparison's result: what goes on which page of
// Document B, in the view's colours, with the notes' words. Inserted, moved
// and replaced text (and a changed header, footer, renumbering or reference)
// is highlighted; deleted text, which B no longer has, gets a caret at the
// place it would have been, found through the content sync points (D-64); a
// changed figure gets a frame. Pure; the Work worker writes them.
import type { TextChange, TextComparison, TextRect } from '../text/match';
import { entriesOf, styleOf, type MarkColours, type PageOf } from '../textView';
import type { MarkKind } from './format';

/** One change on one page of Document B, as the Work worker writes it. */
export interface MarkSpec {
  /** 0-based page of B. */
  page: number;
  kind: MarkKind;
  /** One rectangle per line run, in the page's displayed space (pt, y down): x0 y0 x1 y1. */
  rects: [number, number, number, number][];
  /** A highlight, a caret (deleted text) or a frame (a changed figure). */
  shape: 'highlight' | 'caret' | 'frame';
  /** 0…1 each. */
  colour: [number, number, number];
  /** The note's subject and text (localized). */
  subject: string;
  contents: string;
  old?: string;
  new?: string;
}

/** The notes' words (localized by the caller, rule 11). */
export interface MarkWords {
  /** The subject per kind ("Inserted", "Changed figure" …). */
  subject: Record<MarkKind, string>;
  inserted: string;
  moved: string;
  figure: string;
  /** "was: 1,450.00". */
  was: (old: string) => string;
  /** "Deleted: the old clause". */
  deleted: (old: string) => string;
}

/** The engine's kind as the file names it (the same names). */
export const markKind = (c: TextChange): MarkKind => c.kind;

/** `#rrggbb` → 0…1 each (black for anything else). */
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [1, 2, 3].map((i) => parseInt(m[i] ?? '0', 16) / 255) as [number, number, number];
}

/** Paragraph marks as the engine joins them, read as spaces in a note. */
const plain = (s: string): string => s.replace(/\s*¶\s*/g, ' ').trim();

const CARET_HALF = 4;
const CARET_MAX = 14;

/**
 * Where deleted text would have been in B: through the content sync point
 * before it (side pages; else the first one after it; else the same place),
 * at the old text's left edge. A caret-sized rectangle, in side pages.
 */
export function deletionPlace(sync: Float32Array, rect: TextRect): TextRect {
  let before = -1;
  let after = -1;
  for (let k = 0; k + 3 < sync.length; k += 4) {
    const pa = sync[k] ?? 0;
    const ya = sync[k + 1] ?? 0;
    const le = pa < rect.page || (pa === rect.page && ya <= rect.y0);
    if (le) {
      if (
        before < 0 ||
        pa > (sync[before] ?? 0) ||
        (pa === (sync[before] ?? 0) && ya >= (sync[before + 1] ?? 0))
      )
        before = k;
    } else if (
      after < 0 ||
      pa < (sync[after] ?? 0) ||
      (pa === (sync[after] ?? 0) && ya < (sync[after + 1] ?? 0))
    )
      after = k;
  }
  const h = Math.min(CARET_MAX, Math.max(4, rect.y1 - rect.y0));
  const at = before >= 0 ? before : after;
  let page = rect.page;
  let y = rect.y0;
  if (at >= 0) {
    page = sync[at + 2] ?? rect.page;
    const pa = sync[at] ?? 0;
    // Within the same page the offset from the sync point carries over; across pages it is unknown.
    y =
      pa === rect.page
        ? (sync[at + 3] ?? 0) + (rect.y0 - (sync[at + 1] ?? 0))
        : (sync[at + 3] ?? rect.y0);
  }
  y = Math.max(0, y);
  return {
    page,
    x0: rect.x0 - CARET_HALF,
    y0: y,
    x1: rect.x0 + CARET_HALF,
    y1: y + h,
  };
}

/** The rectangles of a span on B's document pages, by page. */
function byPage(rects: readonly TextRect[], pageOf: PageOf): Map<number, TextRect[]> {
  const out = new Map<number, TextRect[]>();
  for (const r of rects) {
    const p = pageOf(r.page);
    if (p === undefined) continue;
    const list = out.get(p) ?? [];
    list.push(r);
    out.set(p, list);
  }
  return out;
}

const box = (r: TextRect): [number, number, number, number] => [r.x0, r.y0, r.x1, r.y1];

/**
 * Every change of the result as marks on B's pages (a change over several
 * pages gives one mark per page; the old text goes with the first). `pageOfB`
 * maps B's side pages to its document pages.
 */
export function textMarkSpecs(
  result: TextComparison,
  pageOfB: PageOf,
  colours: MarkColours,
  words: MarkWords,
): MarkSpec[] {
  const out: MarkSpec[] = [];
  for (const e of entriesOf(result)) {
    const c = e.change;
    const kind = markKind(c);
    const style = styleOf(c.kind);
    const colour = rgbOf(colours[style === 'figure' ? 'moved' : style]);
    const old = c.a ? plain(c.a.text) : undefined;
    const neu = c.b ? plain(c.b.text) : undefined;
    const subject = words.subject[kind];
    if (style === 'deleted' || !c.b) {
      const first = c.a?.rects[0];
      if (!first) continue;
      const place = deletionPlace(result.sync, first);
      const page = pageOfB(place.page);
      if (page === undefined) continue;
      out.push({
        page,
        kind: 'deleted',
        rects: [box(place)],
        shape: 'caret',
        colour,
        subject: words.subject.deleted,
        contents: words.deleted(old ?? ''),
        ...(old === undefined ? {} : { old }),
      });
      continue;
    }
    const contents =
      style === 'inserted'
        ? words.inserted
        : style === 'moved'
          ? words.moved
          : style === 'figure'
            ? words.figure
            : words.was(old ?? '');
    let first = true;
    for (const [page, rects] of byPage(c.b.rects, pageOfB)) {
      out.push({
        page,
        kind,
        rects: rects.map(box),
        shape: style === 'figure' ? 'frame' : 'highlight',
        colour,
        subject,
        contents,
        ...(first && old !== undefined && style !== 'inserted' ? { old } : {}),
        ...(neu === undefined ? {} : { new: neu }),
      });
      first = false;
    }
  }
  return out;
}
