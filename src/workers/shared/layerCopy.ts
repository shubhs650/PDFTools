// Layer switches for a comparison (follow-up to M12-11, D-59, Q24). PDFium
// has no optional-content API (ADR-012), so a document is drawn with other
// layers shown from a copy: the file's current bytes plus one appended
// incremental update that rewrites the default configuration (/OCProperties
// /D) to the chosen states. The user's file is never touched; the copy lives
// only in the workers that draw it. Pure apart from reading (object layer,
// M3-03).
import {
  N,
  PdfRef,
  isDict,
  nameOf,
  serialize,
  type PdfDict,
  type PdfValue,
} from '../../model/pdf/objects';
import { PdfReader, type Inflate } from '../../model/pdf/reader';
import { concatBytes, encodeLatin1 } from '../render/save/bytes';
import { saveBaseOf, trailerIds, trailerRef, writeXrefSection } from '../render/save/xref';

/** Layer switches of one document: a layer's object number → shown. Only the changed ones. */
export type LayerStates = Readonly<Record<number, boolean>>;

/** The same switches give the same key ('' when none); object numbers in order. */
export function layerKey(states: LayerStates | undefined): string {
  if (!states) return '';
  return Object.entries(states)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([k]) => Number.isInteger(k) && k > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${String(k)}${v ? '+' : '-'}`)
    .join(' ');
}

/**
 * Switches relative to the file's defaults: a switch back to a layer's default
 * is dropped, so "all defaults" needs no copy at all.
 */
export function changedStates(
  defaults: readonly { id: number; on: boolean }[],
  states: LayerStates,
): Record<number, boolean> {
  const out: Record<number, boolean> = {};
  for (const l of defaults) {
    const v = states[l.id];
    if (v !== undefined && v !== l.on) out[l.id] = v;
  }
  return out;
}

export class LayerCopyError extends Error {
  readonly code: 'layers-encrypted' | 'layers-none' | 'layers-damaged';
  constructor(code: LayerCopyError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Object numbers of the references in `v` (an array, possibly indirect, possibly nested). */
async function refsOf(r: PdfReader, v: PdfValue | undefined, depth = 0): Promise<PdfRef[]> {
  if (depth > 32) return [];
  const value = v instanceof PdfRef && depth === 0 ? await r.get(v) : v;
  if (!Array.isArray(value)) return [];
  const out: PdfRef[] = [];
  for (const x of value) {
    if (x instanceof PdfRef) out.push(x);
    else if (Array.isArray(x)) out.push(...(await refsOf(r, x, depth + 1)));
  }
  return out;
}

/**
 * The incremental update that makes `states` the document's default layer
 * visibility: /BaseState /ON with every layer in /ON or /OFF, and no /AS (an
 * automatic state by usage would override the switches). Only the object that
 * holds /D is written: /D itself when it is indirect, else /OCProperties, else
 * the catalog. Returns the bytes to append to `bytes`.
 */
export async function layerPatch(
  bytes: Uint8Array,
  states: LayerStates,
  inflate: Inflate,
): Promise<Uint8Array<ArrayBuffer>> {
  let r: PdfReader;
  try {
    r = await PdfReader.open(bytes, inflate);
  } catch {
    throw new LayerCopyError('layers-damaged', 'The file could not be read');
  }
  if (r.encrypted) throw new LayerCopyError('layers-encrypted', 'The file is encrypted');
  const rootRef = r.trailer.get('Root');
  const root = rootRef instanceof PdfRef ? await r.get(rootRef) : undefined;
  if (!(rootRef instanceof PdfRef) || !isDict(root))
    throw new LayerCopyError('layers-damaged', 'The file has no catalog');
  const propsVal = root.get('OCProperties');
  const props = await r.resolve(propsVal);
  if (!isDict(props)) throw new LayerCopyError('layers-none', 'The file has no layers');
  const ocgs = await refsOf(r, props.get('OCGs'));
  if (ocgs.length === 0) throw new LayerCopyError('layers-none', 'The file has no layers');

  const dVal = props.get('D');
  const d = await r.resolve(dVal);
  const config: PdfDict = new Map<string, PdfValue>(isDict(d) ? d : []);
  const baseOff = nameOf(config.get('BaseState')) === 'OFF';
  const on = new Set((await refsOf(r, config.get('ON'))).map((x) => x.num));
  const off = new Set((await refsOf(r, config.get('OFF'))).map((x) => x.num));
  const shown = (num: number): boolean => states[num] ?? (baseOff ? on.has(num) : !off.has(num));
  const unique = [...new Map(ocgs.map((x) => [x.num, x])).values()];
  config.set('BaseState', N('ON'));
  config.set(
    'ON',
    unique.filter((x) => shown(x.num)),
  );
  config.set(
    'OFF',
    unique.filter((x) => !shown(x.num)),
  );
  config.delete('AS');

  let target: { ref: PdfRef; value: PdfDict };
  if (dVal instanceof PdfRef) target = { ref: dVal, value: config };
  else {
    const nextProps = new Map(props);
    nextProps.set('D', config);
    if (propsVal instanceof PdfRef) target = { ref: propsVal, value: nextProps };
    else {
      const nextRoot = new Map(root);
      nextRoot.set('OCProperties', nextProps);
      target = { ref: rootRef, value: nextRoot };
    }
  }

  const base = saveBaseOf(bytes);
  const eol = base.endsWithEol ? '' : '\n';
  const { num, gen } = target.ref;
  const obj = encodeLatin1(
    `${eol}${String(num)} ${String(gen)} obj\n${serialize(target.value)}\nendobj\n`,
  );
  const at = bytes.length + eol.length;
  const xrefStart = bytes.length + obj.length;
  const info = trailerRef(base.trailer, 'Info');
  const ids = trailerIds(base.trailer);
  const common =
    `/Root ${String(rootRef.num)} ${String(rootRef.gen)} R` +
    (info ? ` /Info ${info}` : '') +
    (ids ? ` /ID [${ids[0]}${ids[1]}]` : '') +
    ` /Prev ${String(base.startxref)}`;
  const size = Math.max(base.size, num + 1);
  const xref = writeXrefSection(
    base.kind,
    xrefStart,
    new Map<number, [number, number]>([[num, [at, gen]]]),
    size,
    common,
  );
  return concatBytes([obj, xref.bytes]);
}

/** The file with `states` as its default layers: `bytes` plus the update (a new buffer). */
export async function layerCopy(
  bytes: Uint8Array,
  states: LayerStates,
  inflate: Inflate,
): Promise<Uint8Array<ArrayBuffer>> {
  return concatBytes([bytes, await layerPatch(bytes, states, inflate)]);
}
