// Store-only ZIP writer (M4-04, M4-Q5): several exported files as one download
// when the browser cannot write to a folder. Built in the Work worker (rule 1);
// no compression (images and XLSX are compressed already, text is small), no
// dependency. APPNOTE 6.3.x: local headers, central directory, UTF-8 names
// (flag bit 11), DOS timestamps, CRC-32; Zip64 is not needed below 4 GiB and
// 65,535 entries, which the caller enforces.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Modification time; defaults to now. */
  date?: Date;
}

export const ZIP_MAX_ENTRIES = 65_535;
export const ZIP_MAX_BYTES = 0xffff_fffe;

let table: Uint32Array | null = null;

export function crc32(data: Uint8Array, crc = 0): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (const b of data) c = (table[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return ~c >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** A name that is safe as an archive path: no absolute paths, no "..", forward slashes. */
export function safeEntryName(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

/** Makes names unique: "a.png", "a (2).png", … (case-insensitive, like most file systems). */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    const dot = n.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, ''];
    let candidate = n;
    for (let i = 2; seen.has(candidate.toLowerCase()); i++)
      candidate = `${base} (${String(i)})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/** The archive as Blob parts (headers and the files' own bytes, no copy of the data). */
export function zipParts(entries: readonly ZipEntry[]): Uint8Array[] {
  if (entries.length > ZIP_MAX_ENTRIES) throw new RangeError('too many files for one archive');
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const names = uniqueNames(entries.map((e) => safeEntryName(e.name)));
  entries.forEach((e, i) => {
    const name = enc.encode(names[i]);
    const crc = crc32(e.data);
    const size = e.data.length;
    const { time, date } = dosTime(e.date ?? new Date());
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    parts.push(local, e.data);
    central.push(head);
    offset += local.length + size;
    if (offset > ZIP_MAX_BYTES) throw new RangeError('archive larger than 4 GiB');
  });
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return [...parts, ...central, end];
}

export function zipBlob(entries: readonly ZipEntry[]): Blob {
  return new Blob(zipParts(entries) as BlobPart[], { type: 'application/zip' });
}
