// Form facts EmbedPDF's widget API doesn't give (M2-14, ADR-013 decision 4):
// each page's /Tabs (tab order) and each field's default value /DV (Reset
// Form). Read from the file's bytes with the object reader of ocg.ts, in the
// Work worker. Encrypted files: /Tabs (a name) still reads from plain
// objects, but /DV strings are encrypted, so defaults stay unknown there.
import { decodeString, dictAt, isEncrypted, objectReader, refsIn, type Inflate } from './ocg';

export type TabOrder = 'R' | 'C' | 'S' | 'A' | null;

export interface FormFacts {
  /** /Tabs per page index (null = not set: /Annots order). */
  tabs: TabOrder[];
  /** Page indexes with an /Annots array (the only pages that can hold widgets). */
  annotated: number[];
  /** Field /DV by object number (fields and their widget kids); null = none. */
  defaults: Record<number, string | null>;
  /** Defaults could not be read (encrypted strings). */
  encrypted: boolean;
}

const refAfter = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return m?.[1] ? Number(m[1]) : null;
};

/** A /DV value as text: a name without its slash, a string decoded, an array's first item. */
export function defaultValue(dict: string): string | null | undefined {
  const at = /\/DV(?![A-Za-z])/.exec(dict);
  if (!at) return undefined; // not set here (may inherit)
  const rest = dict.slice(at.index + 3).trimStart();
  const item = rest.startsWith('[') ? rest.slice(1).trimStart() : rest;
  const name = /^\/([^\s/<>[\]()]+)/.exec(item);
  if (name?.[1])
    return name[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
  const lit = /^\((?:\\.|[^\\)])*\)/s.exec(item);
  if (lit) return decodeString(lit[0]);
  const hex = /^<[0-9A-Fa-f\s]*>/.exec(item);
  if (hex) return decodeString(hex[0]);
  return null;
}

/** The object's own dictionary (the part before any stream). */
const dictOf = (text: string | null): string => (text ? (dictAt(text, 0) ?? '') : '');

export async function readFormFacts(bytes: Uint8Array, inflate: Inflate): Promise<FormFacts> {
  const object = await objectReader(bytes, inflate);
  const encrypted = isEncrypted(bytes);
  const text = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  // The last /Root (the newest trailer or xref stream).
  let root = [...text.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)].pop()?.[1];
  if (!root) {
    // Xref stream files may keep it farther up; look through the whole file.
    const all = new TextDecoder('latin1').decode(bytes);
    root = [...all.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)].pop()?.[1];
  }
  const catalog = dictOf(root ? object(Number(root)) : null);

  // Pages in document order (a depth-first walk of /Kids; a cycle guard).
  const tabs: TabOrder[] = [];
  const annotated: number[] = [];
  const seen = new Set<number>();
  const walk = (num: number): void => {
    if (seen.has(num)) return;
    seen.add(num);
    const node = dictOf(object(num));
    if (
      /\/Type\s*\/Pages\b/.test(node) ||
      (/\/Kids\s*\[/.test(node) && !/\/Type\s*\/Page\b/.test(node))
    ) {
      for (const kid of refsIn(node, 'Kids')) walk(kid);
    } else {
      if (/\/Annots\b/.test(node)) annotated.push(tabs.length);
      const t = /\/Tabs\s*\/([A-Za-z]+)/.exec(node)?.[1];
      tabs.push(t === 'R' || t === 'C' || t === 'S' || t === 'A' ? t : null);
    }
  };
  const pages = refAfter(catalog, 'Pages');
  if (pages !== null) walk(pages);

  // Fields: /AcroForm /Fields, down through /Kids; /DV inherits.
  const defaults: Record<number, string | null> = {};
  const acroRef = refAfter(catalog, 'AcroForm');
  const acro =
    acroRef === null
      ? /\/AcroForm\s*<</.test(catalog)
        ? (dictAt(catalog, catalog.indexOf('/AcroForm')) ?? '')
        : ''
      : dictOf(object(acroRef));
  const visited = new Set<number>();
  const field = (num: number, inherited: string | null): void => {
    if (visited.has(num)) return;
    visited.add(num);
    const dict = dictOf(object(num));
    const own = encrypted ? undefined : defaultValue(dict);
    const dv = own === undefined ? inherited : own;
    defaults[num] = dv;
    for (const kid of refsIn(dict, 'Kids')) field(kid, dv);
  };
  for (const f of refsIn(acro, 'Fields')) field(f, null);
  return { tabs, annotated, defaults, encrypted };
}
