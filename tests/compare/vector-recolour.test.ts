// M12-16 (D-59, ADR-032 route 2): the vector overlay's content tokenizer and
// recolouring, pure (the object layer reads a hand-made PDF; the new objects
// go to an in-memory sink).
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPdf, type PdfObject } from '../../e2e/fixtures/generate';
import { ascii85, fromLatin1, latin1, tokenize } from '../../src/model/compare/vector/content';
import {
  Recolourer,
  lightness,
  tintOf,
  type ObjectSink,
} from '../../src/model/compare/vector/recolour';
import { PdfRef, isDict, type PdfDict, type PdfValue } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';

const inflate = (b: Uint8Array): Promise<Uint8Array> => Promise.resolve(inflateSync(b));

describe('content tokens', () => {
  it('keeps every operand’s exact bytes: strings, hex, arrays, dictionaries, comments', () => {
    const src =
      'BT /F1 12 Tf (a \\) (b) c) Tj <414243> Tj [(x) -20 (y)] TJ ET % note\n/OC /MC0 BDC 1 0 0 rg EMC /P <</MCID 3>> BDC EMC';
    const ins = tokenize(src);
    expect(ins.map((i) => i.op)).toEqual([
      'BT',
      'Tf',
      'Tj',
      'Tj',
      'TJ',
      'ET',
      'BDC',
      'rg',
      'EMC',
      'BDC',
      'EMC',
    ]);
    expect(ins[2]?.operands[0]?.raw).toBe('(a \\) (b) c)');
    expect(ins[4]?.operands[0]?.raw).toBe('[(x) -20 (y)]');
    expect(ins[9]?.operands[1]?.raw).toBe('<</MCID 3>>');
    expect(ins[7]?.operands.map((o) => (o.kind === 'num' ? o.value : null))).toEqual([1, 0, 0]);
  });

  it('reads an inline image whose data holds "EI" up to its real end', () => {
    const src = 'q BI /W 2 /H 1 /CS /G /BPC 8 ID xEIy EI Q';
    const ins = tokenize(src);
    expect(ins.map((i) => i.op)).toEqual(['q', 'BI', 'Q']);
    expect(ins[1]?.raw).toBe('BI /W 2 /H 1 /CS /G /BPC 8 ID xEIy EI');
  });

  it('refuses a broken stream', () => {
    expect(() => tokenize('(unterminated Tj')).toThrow();
    expect(() => tokenize('1 0 0')).toThrow();
  });

  it('decodes ASCII85 and round-trips Latin-1', () => {
    expect(latin1(ascii85(fromLatin1('<~87cURD]i,"Ebo80~>')))).toBe('Hello World!');
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromLatin1(latin1(all))).toEqual(all);
  });
});

describe('lightness and tint', () => {
  it('keeps paper white and makes full ink the full colour', () => {
    expect(tintOf([255, 0, 0], 1)).toEqual([1, 1, 1]);
    expect(tintOf([255, 0, 0], 0)).toEqual([1, 0, 0]);
    expect(tintOf([0, 255, 0], 0.5)).toEqual([0.5, 1, 0.5]);
  });

  it('reads each colour space’s lightness', () => {
    expect(lightness('gray', [0.25])).toBe(0.25);
    expect(lightness('rgb', [1, 0, 0])).toBeCloseTo(0.3);
    expect(lightness('cmyk', [0, 0, 0, 1])).toBe(0);
    expect(lightness('cmyk', [0, 0, 0, 0])).toBeCloseTo(1);
    expect(lightness('sep', [1])).toBe(0);
    expect(lightness('lab', [50, 0, 0])).toBe(0.5);
  });
});

/** A page form (object 4) and what it uses, read back by the object layer. */
async function formPdf(content: string, resources: string, more: PdfObject[] = [], filter = '') {
  const bytes = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /P 4 0 R >> >> >>',
    {
      dict: `<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] ${filter} /Resources ${resources} >>`,
      stream: content,
    },
    ...more,
  ]);
  return PdfReader.open(bytes, inflate);
}

function sink() {
  const objects = new Map<number, { value?: PdfValue; dict?: PdfDict; text?: string }>();
  let next = 1000;
  const s: ObjectSink = {
    alloc: () => ++next,
    put: (num, value) => {
      objects.set(num, { value });
    },
    putStream: (num, dict, data) => {
      objects.set(num, { dict, text: latin1(data) });
      return Promise.resolve();
    },
  };
  return { s, objects };
}

describe('recolouring a form', () => {
  it('rewrites plain colours to the tint of the same lightness and starts in the full tint', async () => {
    const r = await formPdf(
      '0.5 g 0 0 10 10 re f 1 0 0 RG 0 0 m 5 5 l S 0 0 0 1 k 1 1 2 2 re f',
      '<< >>',
    );
    const { s, objects } = sink();
    const rc = new Recolourer(r, s);
    const copy = await rc.form(new PdfRef(4), [0, 255, 0], 'b', true);
    const out = objects.get(copy.num);
    expect(out?.text?.split('\n')).toEqual([
      '0 1 0 rg 0 1 0 RG',
      '0.5 1 0.5 rg',
      '0 0 10 10 re',
      'f',
      '0.3 1 0.3 RG',
      '0 0 m',
      '5 5 l',
      'S',
      '0 1 0 rg',
      '1 1 2 2 re',
      'f',
    ]);
    // The page form is an isolated transparency group.
    const group = out?.dict?.get('Group');
    expect(isDict(group) && group.get('I')).toBe(true);
    expect(rc.stats.colours).toBe(3);
  });

  it('paints images, shadings and spot-colour paths through one-object masks, inside their clip', async () => {
    const r = await formPdf(
      'q 10 0 0 10 0 0 cm /Im Do Q 0 0 50 50 re W n /Sh sh /Spot cs 1 scn 0 0 5 5 re f',
      '<< /XObject << /Im 5 0 R >> /Shading << /Sh 6 0 R >> /ColorSpace << /Spot [/Separation /X /DeviceCMYK 7 0 R] >> >>',
      [
        {
          dict: '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>',
          stream: '\u0080',
        },
        '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0] /Function 7 0 R >>',
        '<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 0 0 0] /N 1 >>',
      ],
    );
    const { s, objects } = sink();
    const rc = new Recolourer(r, s);
    const copy = await rc.form(new PdfRef(4), [255, 0, 0], 'a', true);
    const text = objects.get(copy.num)?.text ?? '';
    expect(rc.stats).toMatchObject({ images: 1, shadings: 1, objectMasks: 1 });
    // Each painted through its own mask with the full tint; the clip comes first.
    expect(text.match(/\/TintMask\d+ gs 1 0 0 rg/g)).toHaveLength(3);
    expect(text).toContain('0 0 50 50 re\nW\nn');
    expect(text).not.toContain('/Im Do');
    // The masks draw the original objects in their own colours.
    const groups = [...objects.values()].map((o) => o.text ?? '');
    expect(groups.some((g) => g.includes('/Im Do'))).toBe(true);
    expect(groups.some((g) => g.includes('/Sh sh'))).toBe(true);
    expect(groups.some((g) => g.includes('/Spot cs') && g.includes('1 scn'))).toBe(true);
  });

  it('copies a nested form once per side and keeps the page’s layers, remapped', async () => {
    const r = await formPdf(
      '/OC /L BDC /F Do EMC /F Do',
      '<< /XObject << /F 5 0 R >> /Properties << /L 6 0 R >> >>',
      [
        { dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] >>', stream: '0 g 0 0 1 1 re f' },
        '<< /Type /OCG /Name (L) >>',
      ],
    );
    const { s, objects } = sink();
    const rc = new Recolourer(r, s, undefined, (n) => (n === 6 ? 60 : undefined));
    const copy = await rc.form(new PdfRef(4), [255, 0, 0], 'a', true);
    expect(rc.stats.forms).toBe(2);
    const res = objects.get(copy.num)?.dict?.get('Resources');
    const props = isDict(res) ? res.get('Properties') : undefined;
    expect(isDict(props) && (props.get('L') as PdfRef).num).toBe(60);
    const xo = isDict(res) ? res.get('XObject') : undefined;
    const nested = isDict(xo) ? (xo.get('F') as PdfRef) : null;
    expect(nested?.num).not.toBe(5);
    expect(objects.get(nested?.num ?? 0)?.text).toBe('1 0 0 rg\n0 0 1 1 re\nf');
  });

  it('draws a form it can’t read through one mask of the whole form', async () => {
    const r = await formPdf('0 g 0 0 1 1 re f', '<< >>', [], '/Filter /LZWDecode');
    const { s, objects } = sink();
    const rc = new Recolourer(r, s);
    const copy = await rc.form(new PdfRef(4), [255, 0, 0], 'a', true);
    expect(rc.stats.wholeMasks).toBe(1);
    expect(objects.get(copy.num)?.text).toBe('q /TintMask gs 1 0 0 rg 0 0 100 100 re f Q');
    expect([...objects.values()].some((o) => o.text?.includes('/F Do'))).toBe(true);
  });

  it('pauses every few thousand instructions (the job’s checkpoint)', async () => {
    const r = await formPdf(Array.from({ length: 9000 }, () => '0 0 m').join(' ') + ' S', '<< >>');
    const { s } = sink();
    let pauses = 0;
    const rc = new Recolourer(r, s, () => {
      pauses++;
      return Promise.resolve();
    });
    await rc.form(new PdfRef(4), [255, 0, 0], 'a', true);
    expect(pauses).toBe(2);
  });
});
