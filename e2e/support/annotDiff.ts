// Annotation dictionaries of a saved PDF compared key by key with another's
// (the JSON comment round trip, ADR-025): qpdf's JSON view of both files, each
// annotation found by its /NM, every value resolved through its references,
// streams by their dictionary and a hash of their decoded data (so appearance
// streams, pictures and attached files must be the same bytes). Node only
// (e2e); needs qpdf; the optional pixel check needs pdftoppm.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type J = null | boolean | number | string | J[] | { [k: string]: J };
type Objects = Map<string, { value?: J; stream?: { dict: J; data?: string } }>;

const dir = mkdtempSync(join(tmpdir(), 'triya-annot-diff-'));
let seq = 0;

function objectsOf(bytes: Uint8Array): Objects {
  const pdf = join(dir, `f${String(++seq)}.pdf`);
  const out = `${pdf}.json`;
  writeFileSync(pdf, bytes);
  const r = spawnSync('qpdf', [
    '--json-output',
    '--json-stream-data=inline',
    '--decode-level=generalized',
    pdf,
    out,
  ]);
  if (r.status !== 0 && r.status !== 3) throw new Error(`qpdf: ${r.stderr.toString()}`);
  const q = (JSON.parse(readFileSync(out, 'utf8')) as { qpdf: [unknown, Record<string, J>] })
    .qpdf[1];
  const m: Objects = new Map();
  for (const [k, v] of Object.entries(q)) {
    if (k.startsWith('obj:'))
      m.set(k.slice(4), v as { value?: J; stream?: { dict: J; data?: string } });
  }
  return m;
}

const isRef = (v: J): v is string => typeof v === 'string' && / \d+ R$/u.test(v);
const isObj = (v: J): v is Record<string, J> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A PDF without any annotations: each page's /Annots removed (qpdf JSON round trip). */
export function stripAnnotations(bytes: Uint8Array): Buffer {
  const pdf = join(dir, `s${String(++seq)}.pdf`);
  writeFileSync(pdf, bytes);
  spawnSync('qpdf', ['--json-output', pdf, `${pdf}.json`]);
  const doc = JSON.parse(readFileSync(`${pdf}.json`, 'utf8')) as {
    qpdf: [unknown, Record<string, { value?: J }>];
  };
  for (const o of Object.values(doc.qpdf[1])) {
    if (isObj(o.value ?? null) && (o.value as Record<string, J>)['/Type'] === '/Page')
      delete (o.value as Record<string, J>)['/Annots'];
  }
  writeFileSync(`${pdf}.json`, JSON.stringify(doc));
  const out = `${pdf}.out.pdf`;
  const r = spawnSync('qpdf', ['--json-input', `${pdf}.json`, out]);
  if (r.status !== 0 && r.status !== 3) throw new Error(`qpdf: ${r.stderr.toString()}`);
  return readFileSync(out);
}

/**
 * Keys whose values are references to other annotations or pages: compared by
 * meaning. A pop-up is compared in full (its /Rect and /Open are the note
 * window's place and state).
 */
const LINKS = new Set(['/P', '/Parent', '/IRT']);
/** Keys that legitimately change on every write. */
const VOLATILE = new Set(['/M']);

function resolve(
  objs: Objects,
  v: J,
  nmOf: (ref: string) => string,
  path: ReadonlySet<string> = new Set(),
): J {
  if (path.size > 40) return '…';
  if (isRef(v)) {
    if (path.has(v)) return '#cycle';
    const o = objs.get(v);
    if (!o) return null;
    const inner = new Set(path).add(v);
    if (o.stream) {
      const dict = resolve(objs, o.stream.dict, nmOf, inner) as Record<string, J>;
      // Filters and lengths may differ for the same data (a re-compressed copy).
      delete dict['/Length'];
      delete dict['/Filter'];
      delete dict['/DecodeParms'];
      const data = createHash('sha256')
        .update(o.stream.data ?? '')
        .digest('hex')
        .slice(0, 16);
      return { '#stream': dict, '#data': data };
    }
    return resolve(objs, o.value ?? null, nmOf, inner);
  }
  if (Array.isArray(v)) return v.map((x) => resolve(objs, x, nmOf, path));
  if (isObj(v)) {
    const out: Record<string, J> = {};
    for (const [k, x] of Object.entries(v)) {
      if (VOLATILE.has(k)) continue;
      if (LINKS.has(k)) out[k] = isRef(x) ? nmOf(x) : x;
      else out[k] = resolve(objs, x, nmOf, path);
    }
    return out;
  }
  return v;
}

export interface Annot {
  nm: string;
  subtype: string;
  dict: Record<string, J>;
}

/** Every annotation with an /NM (links and widgets excluded), references resolved. */
export function annotationsOf(bytes: Uint8Array): Map<string, Annot> {
  const objs = objectsOf(bytes);
  const nmOf = (ref: string): string => {
    const v = objs.get(ref)?.value;
    if (!isObj(v ?? null)) return 'ref';
    const d = v as Record<string, J>;
    if (d['/Type'] === '/Page') return 'page';
    if (d['/Subtype'] === '/Popup') return 'popup';
    return typeof d['/NM'] === 'string' ? `nm:${d['/NM']}` : 'annot';
  };
  const out = new Map<string, Annot>();
  for (const [, o] of objs) {
    const v = o.value;
    if (!isObj(v ?? null)) continue;
    const d = v as Record<string, J>;
    const sub = d['/Subtype'];
    if (typeof sub !== 'string' || typeof d['/NM'] !== 'string') continue;
    if (sub === '/Link' || sub === '/Widget' || sub === '/Popup') continue;
    out.set(d['/NM'], {
      nm: d['/NM'],
      subtype: sub,
      dict: resolve(objs, d, nmOf) as Record<string, J>,
    });
  }
  return out;
}

export interface KeyDiff {
  key: string;
  before: J | undefined;
  after: J | undefined;
}

const num = (x: J) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x);
function norm(v: J | undefined): J | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => norm(x) ?? null);
  if (isObj(v)) {
    const o: Record<string, J> = {};
    for (const k of Object.keys(v).sort()) o[k] = norm(v[k]) ?? null;
    return o;
  }
  return num(v);
}

/** The top-level keys whose values differ (numbers to 0.01). */
export function diffAnnot(a: Annot, b: Annot | undefined): KeyDiff[] | 'missing' {
  if (!b) return 'missing';
  const keys = new Set([...Object.keys(a.dict), ...Object.keys(b.dict)]);
  const out: KeyDiff[] = [];
  for (const k of [...keys].sort()) {
    const x = norm(a.dict[k]);
    const y = norm(b.dict[k]);
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ key: k, before: x, after: y });
  }
  return out;
}

export const hasPdftoppm = (): boolean => spawnSync('pdftoppm', ['-v']).error === undefined;

/** Each page as raw RGB at 72 dpi (pdftoppm), for a pixel comparison. */
export function renderPages(bytes: Uint8Array): Buffer[] {
  const pdf = join(dir, `r${String(++seq)}.pdf`);
  writeFileSync(pdf, bytes);
  const out: Buffer[] = [];
  for (let p = 1; ; p++) {
    const r = spawnSync('pdftoppm', ['-r', '72', '-f', String(p), '-l', String(p), pdf], {
      maxBuffer: 1 << 28,
    });
    if (r.status !== 0 || r.stdout.length === 0) break;
    out.push(r.stdout);
  }
  return out;
}

/** The share of differing pixels between two PPM renders of the same size (1 when sizes differ). */
export function pixelDiff(a: Buffer, b: Buffer): number {
  if (a.length !== b.length) return 1;
  let n = 0;
  let px = 0;
  // Pixels from the end (the PPM header is at the start and the same for the same size).
  for (let i = a.length - 3; i >= 0; i -= 3, px++) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs(a.readUInt8(i + c) - b.readUInt8(i + c)) > 8) {
        n++;
        break;
      }
    }
  }
  return px ? n / px : 0;
}
