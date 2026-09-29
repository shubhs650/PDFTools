import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, safeEntryName, uniqueNames, zipBlob, zipParts } from '../../src/workers/work/zip';

/** A minimal reader: the central directory's entries, with stored data sliced out. */
function readZip(bytes: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const localNameLen = v.getUint16(local + 26, true);
    const start = local + 30 + localNameLen;
    out.push({ name, crc, data: bytes.subarray(start, start + size) });
    at += 46 + nameLen;
  }
  return out;
}

const enc = (s: string) => new TextEncoder().encode(s);

describe('ZIP writer (M4-04, M4-Q5)', () => {
  it('CRC-32 matches the standard check value', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes stored entries that read back byte for byte, with UTF-8 names', async () => {
    const big = new Uint8Array(300_000).map((_, i) => (i * 31) & 255);
    const entries = [
      { name: 'page-1.txt', data: enc('Hello') },
      { name: 'Größe/Überblick.txt', data: enc('Grüße') },
      { name: 'page-2-image-1.png', data: big },
      { name: 'empty.txt', data: new Uint8Array() },
    ];
    const blob = zipBlob(entries);
    expect(blob.type).toBe('application/zip');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const back = readZip(bytes);
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    back.forEach((e, i) => {
      expect(e.data).toEqual(entries[i]?.data);
      expect(e.crc).toBe(crc32(entries[i]?.data ?? new Uint8Array()));
    });
  });

  it('passes `unzip -t` (an independent reader)', async () => {
    const r0 = spawnSync('unzip', ['-v']);
    if (r0.status !== 0) return; // not installed on this machine
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'out.zip');
    const bytes = new Uint8Array(
      await zipBlob([
        { name: 'a.txt', data: enc('alpha') },
        { name: 'dir/b.bin', data: new Uint8Array(70_000).fill(7) },
      ]).arrayBuffer(),
    );
    writeFileSync(file, bytes);
    const r = spawnSync('unzip', ['-t', file]);
    expect(r.stdout.toString()).toContain('No errors detected');
  });

  it('keeps entry names inside the archive and unique', () => {
    expect(safeEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(safeEntryName('C:\\x\\..\\y.png')).toBe('C:/x/y.png');
    expect(safeEntryName('')).toBe('file');
    expect(uniqueNames(['a.png', 'A.png', 'a.png', 'b'])).toEqual([
      'a.png',
      'A (2).png',
      'a (3).png',
      'b',
    ]);
  });

  it('refuses more entries than the format allows without Zip64', () => {
    const many = Array.from({ length: 65_536 }, () => ({ name: 'x', data: new Uint8Array() }));
    expect(() => zipParts(many)).toThrow(RangeError);
  });
});
