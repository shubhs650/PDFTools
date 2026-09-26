// Search logic for the Work worker (D-08, §6, ADR-006 decision 1), promoted
// from spikes/s5-search/search-core.ts. Pure: matching runs over each page's
// text as PDFium extracts it (FPDFText_GetText, UTF-16). Options: match case,
// whole word, wildcards, regex.

export interface SearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  /** `*` = any run of non-space characters, `?` = one character. */
  wildcards?: boolean;
  regex?: boolean;
}

export interface Hit {
  /** 0-based page index. */
  page: number;
  /** UTF-16 index in the page text (PDFium maps it: FPDFText_GetCharIndexFromTextIndex). */
  start: number;
  length: number;
  /** Context around the hit for the results list (whitespace collapsed). */
  before: string;
  match: string;
  after: string;
}

/** Why a query can't run. Codes only: messages are the UI's (rules 10, 11). */
export type QueryErrorCode = 'search-empty-query' | 'search-invalid-query' | 'search-matches-empty';

export class QueryError extends Error {
  override readonly name = 'QueryError';
  readonly code: QueryErrorCode;
  constructor(code: QueryErrorCode) {
    super(code);
    this.code = code;
  }
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compiles the user's query into a global RegExp, or throws a QueryError. */
export function compileQuery(query: string, opts: SearchOptions = {}): RegExp {
  const q = query.trim();
  if (!q) throw new QueryError('search-empty-query');
  let source: string;
  if (opts.regex) {
    source = q;
  } else if (opts.wildcards) {
    source = Array.from(q, (c) => (c === '*' ? '\\S*' : c === '?' ? '\\S' : escape(c))).join('');
  } else {
    // Whitespace in the query matches any run of whitespace (line breaks in PDF text).
    source = q.split(/\s+/).map(escape).join('\\s+');
  }
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  let re: RegExp;
  try {
    re = new RegExp(source, `gu${opts.matchCase ? '' : 'i'}`);
  } catch {
    throw new QueryError('search-invalid-query');
  }
  if (re.test('')) throw new QueryError('search-matches-empty');
  re.lastIndex = 0;
  return re;
}

/** Hits of `re` in one page's text, with ~`ctx` characters of context, at most `limit`. */
export function findInPage(
  text: string,
  page: number,
  re: RegExp,
  ctx = 40,
  limit = Number.POSITIVE_INFINITY,
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

/** Number of hits of `re` in `text`, without building them (pages past the context cap). */
export function countInPage(text: string, re: RegExp): number {
  let n = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) re.lastIndex++;
    else n++;
  }
  return n;
}

/**
 * Search order (§6, ADR-006): the visible pages first, then onward from the
 * last visible page, wrapping around.
 */
export function searchOrder(pageCount: number, visible: readonly number[]): number[] {
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
 * Collects streamed results and flushes them at most every `intervalMs`
 * (ADR-006: batches ≥ 50 ms apart), and on `final`.
 */
export class Batcher<T> {
  private buf: T[] = [];
  private last: number;
  private readonly flush: (items: T[]) => void;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(
    flush: (items: T[]) => void,
    intervalMs = 50,
    now: () => number = () => performance.now(),
  ) {
    this.flush = flush;
    this.intervalMs = intervalMs;
    this.now = now;
    this.last = now();
  }

  push(items: readonly T[], final = false): void {
    for (const i of items) this.buf.push(i);
    const t = this.now();
    if (final || t - this.last >= this.intervalMs) {
      this.flush(this.buf.splice(0));
      this.last = t;
    }
  }
}
