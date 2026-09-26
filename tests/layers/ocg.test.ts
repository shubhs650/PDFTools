import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { hasQpdf, qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import { layersPdf, simplePdf } from '../../e2e/fixtures/generate';
import { decodeString, dictAt, readLayers, refsIn } from '../../src/model/ocg';

// M2-11: the list-only Layers pane's reader (ADR-012 decision 5, option 1).

const inflate = (b: Uint8Array) => Promise.resolve(new Uint8Array(inflateSync(b)));

describe('ocg scanner pieces', () => {
  it('balanced dictionaries, references and strings', () => {
    expect(dictAt('x << /A << /B (>>) >> /C 1 >> y', 0)).toBe('<< /A << /B (>>) >> /C 1 >>');
    expect(refsIn('<< /OCGs [3 0 R 12 0 R] >>', 'OCGs')).toEqual([3, 12]);
    expect(decodeString('(Plan \\(A\\))')).toBe('Plan (A)');
    expect(decodeString('<FEFF0044006D>')).toBe('Dm');
    expect(decodeString('(\\101\\102)')).toBe('AB');
  });
});

describe('readLayers', () => {
  it('lists names and default visibility in /Order', async () => {
    expect(await readLayers(layersPdf(), inflate)).toEqual({
      encrypted: false,
      layers: [
        { name: 'Dimensions', on: true },
        { name: 'Hidden notes', on: false },
      ],
    });
  });

  it('a file without layers has none', async () => {
    expect(await readLayers(simplePdf(1), inflate)).toEqual({ encrypted: false, layers: [] });
  });

  it.skipIf(!hasQpdf())('reads layers packed in object streams', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdftools-ocg-'));
    writeFileSync(join(dir, 'in.pdf'), layersPdf());
    spawnSync('qpdf', ['--object-streams=generate', join(dir, 'in.pdf'), join(dir, 'out.pdf')]);
    const packed = new Uint8Array(readFileSync(join(dir, 'out.pdf')));
    expect(new TextDecoder('latin1').decode(packed)).toContain('/ObjStm');
    expect((await readLayers(packed, inflate)).layers).toEqual([
      { name: 'Dimensions', on: true },
      { name: 'Hidden notes', on: false },
    ]);
  });

  it.skipIf(!hasQpdf())('says so for an encrypted file', async () => {
    const enc = qpdfEncrypt(layersPdf(), '', 'owner', ['256']);
    expect(await readLayers(enc, inflate)).toEqual({ encrypted: true, layers: [] });
  });
});
