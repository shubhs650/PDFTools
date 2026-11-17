// Self-made font files for the "fonts on this computer" tests (M11-08·O5,
// D-54; CLAUDE.md rule 13), built at test time from the vendored library
// fonts (OFL-1.1 / Apache-2.0, already shipped): a copy whose license bits
// forbid embedding, a collection (.ttc) of two faces, and a font with
// PostScript (CFF) outlines that is only a table directory. Nothing is committed.

interface Table {
  tag: string;
  data: Uint8Array;
}

const u32 = (b: Uint8Array, o: number): number =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o);
const u16 = (b: Uint8Array, o: number): number =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o);

/** The tables of a single font file, in directory order. */
export function tablesOf(font: Uint8Array): { version: number; tables: Table[] } {
  const n = u16(font, 4);
  const tables: Table[] = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(...font.subarray(o, o + 4));
    const off = u32(font, o + 8);
    const len = u32(font, o + 12);
    tables.push({ tag, data: font.subarray(off, off + len) });
  }
  return { version: u32(font, 0), tables };
}

const pad = (n: number): number => (n + 3) & ~3;

function directory(
  version: number,
  tables: readonly Table[],
  offsets: readonly number[],
): Uint8Array {
  const out = new Uint8Array(12 + tables.length * 16);
  const v = new DataView(out.buffer);
  v.setUint32(0, version);
  v.setUint16(4, tables.length);
  for (const [i, t] of tables.entries()) {
    const o = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[o + k] = t.tag.charCodeAt(k);
    v.setUint32(o + 8, offsets[i] ?? 0);
    v.setUint32(o + 12, t.data.length);
  }
  return out;
}

/** A single font file from its tables. */
export function buildFont(version: number, tables: readonly Table[]): Uint8Array {
  let at = pad(12 + tables.length * 16);
  const offsets = tables.map((t) => {
    const o = at;
    at += pad(t.data.length);
    return o;
  });
  const out = new Uint8Array(at);
  out.set(directory(version, tables, offsets), 0);
  for (const [i, t] of tables.entries()) out.set(t.data, offsets[i] ?? 0);
  return out;
}

/** A copy of `font` with OS/2 fsType (the embedding bits) set to `fsType`. */
export function withFsType(font: Uint8Array, fsType: number): Uint8Array {
  const out = font.slice();
  const n = u16(out, 4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (String.fromCharCode(...out.subarray(o, o + 4)) === 'OS/2') {
      new DataView(out.buffer).setUint16(u32(out, o + 8) + 8, fsType);
      return out;
    }
  }
  throw new Error('no OS/2 table');
}

/** A font collection (.ttc, version 1) of `fonts`, each face with its own tables. */
export function buildCollection(fonts: readonly Uint8Array[]): Uint8Array {
  const parts = fonts.map((f) => tablesOf(f));
  let at = 12 + fonts.length * 4;
  const dirAt = parts.map((p) => {
    const o = at;
    at = pad(at + 12 + p.tables.length * 16);
    return o;
  });
  const tableAt = parts.map((p) =>
    p.tables.map((t) => {
      const o = at;
      at += pad(t.data.length);
      return o;
    }),
  );
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0); // 'ttcf'
  v.setUint32(4, 0x00010000);
  v.setUint32(8, fonts.length);
  for (const [i, p] of parts.entries()) {
    v.setUint32(12 + i * 4, dirAt[i] ?? 0);
    const offs = tableAt[i] ?? [];
    out.set(directory(p.version, p.tables, offs), dirAt[i] ?? 0);
    for (const [k, t] of p.tables.entries()) out.set(t.data, offs[k] ?? 0);
  }
  return out;
}

/** A font with PostScript outlines ('OTTO', a CFF table): the tables of `font` but glyf/loca. */
export function asCffFont(font: Uint8Array): Uint8Array {
  const { tables } = tablesOf(font);
  const kept = tables.filter((t) => t.tag !== 'glyf' && t.tag !== 'loca');
  return buildFont(0x4f54544f, [...kept, { tag: 'CFF ', data: new Uint8Array(16) }]);
}
