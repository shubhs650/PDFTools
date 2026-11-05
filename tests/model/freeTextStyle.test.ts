// ADR-024: the /DS string we write, the text colour read from another
// viewer's /DS, and the text recolouring of PDFium's appearance content.
import { describe, expect, it } from 'vitest';
import {
  colorFromDefaultStyle,
  defaultStyleString,
  normalizeHex,
  recolorText,
} from '../../src/model/freeTextStyle';

describe('/DS', () => {
  it('is written as Acrobat writes it: font, size, alignment, colour', () => {
    expect(
      defaultStyleString({ fontFamily: 1, fontSize: 18, textAlign: 1, color: '#0000ff' }),
    ).toBe('font: bold Courier 18pt; text-align:center; color:#0000FF');
    expect(
      defaultStyleString({ fontFamily: 10, fontSize: 10.5, textAlign: 2, color: '#f00' }),
    ).toBe('font: bold italic Times 10.5pt; text-align:right; color:#FF0000');
    expect(defaultStyleString({ color: 'nonsense' })).toBe(
      'font: Helvetica 12pt; text-align:left; color:#000000',
    );
  });

  it('gives its text colour back (hex, short hex, rgb()); null without one', () => {
    expect(
      colorFromDefaultStyle('font: Helvetica,sans-serif 12.0pt; text-align:left; color:#0000ff '),
    ).toBe('#0000FF');
    expect(colorFromDefaultStyle('color:#f80; font: Times 9pt')).toBe('#FF8800');
    expect(colorFromDefaultStyle('font: Arial 10pt;color: rgb(0, 128, 255)')).toBe('#0080FF');
    expect(colorFromDefaultStyle('font: Arial 10pt; background-color:#ff0000')).toBeNull();
    expect(colorFromDefaultStyle('font: Arial 10pt')).toBeNull();
    expect(colorFromDefaultStyle(undefined)).toBeNull();
    expect(normalizeHex('abc')).toBe('#AABBCC');
    expect(normalizeHex('#12345')).toBeNull();
  });
});

// As PDFium generates a text box with a border (spike S25).
const AP = `/GS gs q
1 1 0 rg
101 663 198 78 re f
Q
q
1 0 0 rg
100 662 200 80 re
102 664 196 76 re f*
Q
/Tx BMC
q
BT
1 0 0 rg
102 727.84802 Td
/FXF_Times-Italic 14 Tf
(Line one ET 1 0 0 rg \\(BT\\)) Tj
0 -15.6380005 Td
(Line two) Tj
ET
Q
EMC
`;

describe('recolorText', () => {
  it('changes only the colour inside BT … ET; the border, the fill and the strings stay', () => {
    const r = recolorText(AP, '#0000FF');
    expect(r).toMatchObject({ ok: true, changed: true });
    if (!r.ok) return;
    expect(r.content).toBe(AP.replace('BT\n1 0 0 rg', 'BT\n0 0 1 rg'));
    expect(r.content).toContain('(Line one ET 1 0 0 rg \\(BT\\)) Tj');
    expect(r.content).toContain('1 1 0 rg\n101 663');
  });

  it('recolours every text block and keeps mid colours exact', () => {
    const two = 'BT 0 g /F 9 Tf (a) Tj ET q BT 0.2 0.4 0.6 rg (b) Tj ET Q';
    const r = recolorText(two, '#336699');
    expect(r).toMatchObject({ ok: true, changed: true });
    if (r.ok)
      expect(r.content).toBe('BT 0.2 0.4 0.6 rg /F 9 Tf (a) Tj ET q BT 0.2 0.4 0.6 rg (b) Tj ET Q');
  });

  it('reports no change when the text already has the colour (a callout)', () => {
    expect(recolorText('BT 0 0 1 rg (x) Tj ET', '#0000ff')).toEqual({
      ok: true,
      content: 'BT 0 0 1 rg (x) Tj ET',
      changed: false,
    });
  });

  it('refuses what it does not expect: no text, two colours, colour spaces, no colour', () => {
    expect(recolorText('q 1 0 0 RG 0 0 10 10 re S Q', '#0000ff')).toEqual({
      ok: false,
      reason: 'no-text',
    });
    for (const c of [
      'BT 1 0 0 rg (a) Tj 0 1 0 rg (b) Tj ET',
      'BT /CS0 cs 1 sc (a) Tj ET',
      'BT /F 9 Tf (a) Tj ET',
      'BT 1 0 0 rg (a) Tj',
      'BT 1 0 rg (a) Tj ET',
    ])
      expect(recolorText(c, '#0000ff'), c).toEqual({ ok: false, reason: 'unexpected' });
    expect(recolorText('BT 0 g ET', 'blue')).toEqual({ ok: false, reason: 'unexpected' });
  });
});
