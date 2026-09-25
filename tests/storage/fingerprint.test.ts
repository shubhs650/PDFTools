import { describe, expect, it } from 'vitest';
import { SAMPLE_BYTES, findTrailerId, fingerprint } from '../../src/storage/fingerprint';

const enc = new TextEncoder();

function pdf(bodyBytes: number, id: string, seed = 0): Uint8Array {
  const head = enc.encode('%PDF-1.7\n');
  const trailer = enc.encode(`trailer\n<< /Size 3 /ID [<${id}> <${id}>] >>\nstartxref\n0\n%%EOF\n`);
  const out = new Uint8Array(head.length + bodyBytes + trailer.length);
  out.set(head, 0);
  for (let i = 0; i < bodyBytes; i++) out[head.length + i] = (i * 31 + seed) & 0xff;
  out.set(trailer, head.length + bodyBytes);
  return out;
}

const blob = (b: Uint8Array): Blob => new Blob([b as Uint8Array<ArrayBuffer>]);

describe('findTrailerId', () => {
  it('reads the first /ID string as lower-case hex', () => {
    expect(findTrailerId(enc.encode('<< /ID [ <AB12 cd> <ffff> ] >>'))).toBe('ab12cd');
    expect(findTrailerId(enc.encode('<< /Size 1 >>'))).toBe('');
  });
});

describe('fingerprint (M1-12)', () => {
  it('is stable: same bytes, same fingerprint (also for a copy)', async () => {
    const bytes = pdf(300_000, 'AA');
    const a = await fingerprint(blob(bytes));
    const b = await fingerprint(blob(bytes.slice()));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('differs for a different file of the same size', async () => {
    expect(await fingerprint(blob(pdf(300_000, 'AA')))).not.toBe(
      await fingerprint(blob(pdf(300_000, 'BB'))),
    );
    expect(await fingerprint(blob(pdf(300_000, 'AA', 0)))).not.toBe(
      await fingerprint(blob(pdf(300_000, 'AA', 1))),
    );
  });

  it('changes when the tail of the file changes (a saved increment is a new file)', async () => {
    const bytes = pdf(300_000, 'AA');
    const edited = bytes.slice();
    const i = bytes.length - SAMPLE_BYTES / 2;
    edited[i] = (edited[i] ?? 0) ^ 0xff;
    expect(await fingerprint(blob(edited))).not.toBe(await fingerprint(blob(bytes)));
  });

  it('does not depend on the recovery tail: it is computed from the original only', async () => {
    const original = pdf(300_000, 'AA');
    const fp = await fingerprint(blob(original));
    // The recovery tail is stored beside the original (opfs.ts), not appended to
    // the fingerprinted bytes, so snapshots with different tails share the key.
    expect(await fingerprint(blob(original))).toBe(fp);
  });

  it('handles files smaller than the sample window', async () => {
    const tiny = pdf(10, 'CC');
    expect(await fingerprint(blob(tiny))).toBe(await fingerprint(blob(tiny.slice())));
  });

  it('reads only the sampled slices of a large blob', async () => {
    const big = pdf(4 * SAMPLE_BYTES, 'DD');
    const reads: [number, number | undefined][] = [];
    class SpyBlob extends Blob {
      override slice(start?: number, end?: number): Blob {
        reads.push([start ?? 0, end]);
        return super.slice(start, end);
      }
    }
    await fingerprint(new SpyBlob([big as Uint8Array<ArrayBuffer>]));
    const read = reads.reduce((n, [s, e]) => n + ((e ?? big.length) - s), 0);
    expect(read).toBe(2 * SAMPLE_BYTES);
  });
});
