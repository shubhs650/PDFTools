// M2-14: /Tabs per page and /DV per field, read from the file's bytes.
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPdf, fullFormPdf } from '../../e2e/fixtures/generate';
import { defaultValue, readFormFacts } from '../../src/model/formFacts';

const inflate = (b: Uint8Array) => Promise.resolve(new Uint8Array(inflateSync(b)));

describe('defaultValue', () => {
  it('reads names, strings, hex strings and arrays', () => {
    expect(defaultValue('<< /DV /Yes >>')).toBe('Yes');
    expect(defaultValue('<< /DV /A#20B >>')).toBe('A B');
    expect(defaultValue('<< /DV (DN\\(50\\)) >>')).toBe('DN(50)');
    expect(defaultValue('<< /DV <FEFF00E9> >>')).toBe('é');
    expect(defaultValue('<< /DV [(One) (Two)] >>')).toBe('One');
    expect(defaultValue('<< /V (x) >>')).toBeUndefined();
    expect(defaultValue('<< /DVx 1 >>')).toBeUndefined();
  });
});

describe('readFormFacts', () => {
  it('reads the fixture: /Tabs /R and the defaults, radio kids inheriting', async () => {
    const f = await readFormFacts(fullFormPdf(), inflate);
    expect(f.tabs).toEqual(['R']);
    expect(f.annotated).toEqual([0]);
    expect(f.encrypted).toBe(false);
    expect(f.defaults[6]).toBe('Default'); // name
    expect(f.defaults[8]).toBeNull(); // first
    expect(f.defaults[10]).toBe('Yes'); // agree
    expect(f.defaults[13]).toBe('B'); // choice
    expect(f.defaults[11]).toBe('B'); // its kids inherit
    expect(f.defaults[12]).toBe('B');
    expect(f.defaults[14]).toBe('DN50'); // size
    expect(f.defaults[22]).toBeNull(); // material
  });

  it('walks nested page trees in order', async () => {
    const pdf = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 3 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [5 0 R 6 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Tabs /S >>',
      '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 10 10] /Tabs /C >>',
      '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 10 10] >>',
    ]);
    const f = await readFormFacts(pdf, inflate);
    expect(f.tabs).toEqual(['C', null, 'S']);
    expect(f.annotated).toEqual([]);
    expect(f.defaults).toEqual({});
  });
});
