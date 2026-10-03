import { describe, expect, it } from 'vitest';
import { winAnsiByte, winAnsiBytes } from '../../src/model/ocr/winAnsi';

describe('WinAnsi encoding (ADR-020 d4)', () => {
  it('ASCII and Latin-1 map to themselves; the 0x80–0x9F slots hold their WinAnsi characters', () => {
    expect(winAnsiByte('A')).toBe(0x41);
    expect(winAnsiByte('°')).toBe(0xb0);
    expect(winAnsiByte('±')).toBe(0xb1);
    expect(winAnsiByte('€')).toBe(0x80);
    expect(winAnsiByte('–')).toBe(0x96);
    expect(winAnsiByte('’')).toBe(0x92);
    expect(winAnsiByte('Ÿ')).toBe(0x9f);
  });

  it('characters without a WinAnsi byte are dropped', () => {
    expect(winAnsiByte('≤')).toBeUndefined();
    expect(winAnsiByte('Ω')).toBeUndefined();
    expect(winAnsiByte('中')).toBeUndefined();
    expect(winAnsiByte('\u0085')).toBeUndefined(); // a C1 control, not a WinAnsi slot
    expect(Array.from(winAnsiBytes('≤5 °C'))).toEqual([0x35, 0x20, 0xb0, 0x43]);
    expect(winAnsiBytes('中文').length).toBe(0);
  });
});
