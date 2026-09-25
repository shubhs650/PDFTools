// M0-S5 pure search logic (runs in the Work worker). ARCHITECTURE §6: options
// match case, whole word, wildcards/regex. Matching runs over each page's
// extracted text; string indices equal PDFium char indices, so hits can be
// turned into highlight rects later (FPDFText_CountRects / GetRect).

export interface SearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  /** `*` = any run of non-space chars, `?` = one char. */
  wildcards?: boolean;
  regex?: boolean;
}

export interface Hit {
  page: number;
  /** Char index in the page text (= PDFium char index). */
  start: number;
  length: number;
  /** Context around the hit for the results list. */
  before: string;
  match: string;
  after: string;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile the user's query into a global RegExp, or throw for an invalid regex. */
export function compileQuery(query: string, opts: SearchOptions = {}): RegExp {
  const q = query.trim();
  if (!q) throw new Error('empty query');
  let source: string;
  if (opts.regex) {
    source = q;
  } else if (opts.wildcards) {
    source = q
      .split('')
      .map((c) => (c === '*' ? '\\S*' : c === '?' ? '\\S' : escape(c)))
      .join('');
  } else {
    // Whitespace in the query matches any run of whitespace (line breaks in PDF text).
    source = q.split(/\s+/).map(escape).join('\\s+');
  }
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  const re = new RegExp(source, `gu${opts.matchCase ? '' : 'i'}`);
  if (re.test('')) throw new Error('query matches the empty string');
  re.lastIndex = 0;
  return re;
}

/** All hits of `re` in one page's text, with ~`ctx` chars of context. */
export function findInPage(
  text: string,
  page: number,
  re: RegExp,
  ctx = 40,
  limit = 10_000,
): Hit[] {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m && hits.length < limit; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    hits.push({
      page,
      start,
      length: m[0].length,
      before: text.slice(Math.max(0, start - ctx), start).replace(/\s+/g, ' '),
      match: m[0],
      after: text.slice(end, end + ctx).replace(/\s+/g, ' '),
    });
  }
  return hits;
}

/**
 * Search order (§6: index lazily in viewport order, then the rest): the
 * visible pages first, then onward from the last visible page, wrapping.
 */
export function searchOrder(pageCount: number, visible: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const add = (p: number): void => {
    if (p >= 0 && p < pageCount && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  const valid = visible.filter((p) => p >= 0 && p < pageCount);
  for (const p of valid) add(p);
  const from = valid.length ? Math.max(...valid) + 1 : 0;
  for (let i = 0; i < pageCount; i++) add((from + i) % pageCount);
  return out;
}

/**
 * Batches streamed results: flush when `intervalMs` has passed since the last
 * flush (§6 / M0 plan: no more often than ~50 ms), or on `final`.
 */
export class Batcher<T> {
  private buf: T[] = [];
  private last: number;
  constructor(
    private readonly flush: (items: T[]) => void,
    private readonly intervalMs = 50,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.last = now();
  }
  push(items: T[], final = false): void {
    this.buf.push(...items);
    const t = this.now();
    if (final || t - this.last >= this.intervalMs) {
      this.flush(this.buf.splice(0));
      this.last = t;
    }
  }
}
