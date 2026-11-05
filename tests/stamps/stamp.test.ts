import { describe, expect, it } from 'vitest';
import { createFormatters } from '../../src/i18n/format';
import { fitToPage, fitWithin, needsCjk, STAMP_SIZE, stampText } from '../../src/model/stamp';

describe('dynamic stamp text (M3-14)', () => {
  it('lays out code and label, reviewer and date, document and revision', () => {
    const s = stampText({
      code: 'B',
      label: 'Approved as Noted',
      reviewer: 'Ana de Vries',
      date: '28 Sep 2026',
      docNo: 'P-1001',
      rev: 'C',
    });
    expect(s.lines).toEqual([
      'B  Approved as Noted',
      'Ana de Vries · 28 Sep 2026',
      'P-1001 · Rev. C',
    ]);
    expect(s.subject).toBe('B Approved as Noted');
    expect(s.contents).toBe('B Approved as Noted\nAna de Vries · 28 Sep 2026\nP-1001 · Rev. C');
  });

  it('leaves out what is missing', () => {
    expect(
      stampText({ code: '1', label: 'Approved', reviewer: '', date: 'd', docNo: '', rev: '' })
        .lines,
    ).toEqual(['1  Approved', 'd']);
    expect(
      stampText({ code: '1', label: 'Approved', reviewer: 'R', date: 'd', docNo: '', rev: 'B' })
        .lines[2],
    ).toBe('Rev. B');
    expect(
      stampText({ code: '1', label: 'Approved', reviewer: 'R', date: 'd', docNo: 'D-7', rev: '' })
        .lines[2],
    ).toBe('D-7');
  });

  it('keeps long labels whole (the drawing squeezes them) and knows when CJK fonts are needed', () => {
    const long = 'Approved subject to the comments on sheets 4 to 17 and the revised schedule';
    expect(
      stampText({ code: 'AN', label: long, reviewer: 'R', date: 'd', docNo: '', rev: '' }).lines[0],
    ).toBe(`AN  ${long}`);
    expect(needsCjk('承認 済み')).toBe(true);
    expect(needsCjk('검토 완료')).toBe(true);
    expect(needsCjk('Ｆｕｌｌ')).toBe(false);
    expect(needsCjk('Approved')).toBe(false);
  });

  it('formats the date in the user’s locale', () => {
    const at = new Date(Date.UTC(2026, 8, 28, 12));
    expect(createFormatters('en-US').date(at)).toBe('Sep 28, 2026');
    expect(createFormatters('de-DE').date(at)).toBe('28.09.2026');
  });

  it('fits images within the stamp size, keeping the aspect ratio', () => {
    expect(STAMP_SIZE).toEqual({ width: 170, height: 60 });
    expect(fitWithin({ width: 1000, height: 500 }, 200)).toEqual({ width: 200, height: 100 });
    expect(fitWithin({ width: 50, height: 100 }, 200)).toEqual({ width: 50, height: 100 });
    const tall = fitWithin({ width: 300, height: 900 }, 200);
    expect(tall.height).toBe(200);
    expect(tall.width).toBeCloseTo(200 / 3, 9);
  });
});

describe('pasted image size (M7-08, D-45)', () => {
  const A4 = { width: 595.28, height: 841.89 };

  it('fits a 4000 × 3000 screenshot inside 90 % of an A4 page, aspect ratio kept', () => {
    const s = fitToPage({ width: 4000, height: 3000 }, A4);
    expect(s.width).toBeCloseTo(A4.width * 0.9, 6);
    expect(s.width / s.height).toBeCloseTo(4 / 3, 9);
    expect(s.height).toBeLessThanOrEqual(A4.height * 0.9);
  });

  it('fits a tall image by the page height', () => {
    const s = fitToPage({ width: 1000, height: 8000 }, A4);
    expect(s.height).toBeCloseTo(A4.height * 0.9, 6);
    expect(s.height / s.width).toBeCloseTo(8, 9);
  });

  it('places a small icon at its own size at 96 dpi, never enlarged', () => {
    expect(fitToPage({ width: 64, height: 32 }, A4)).toEqual({ width: 48, height: 24 });
  });

  it('fits a landscape page by its own sides', () => {
    const s = fitToPage({ width: 2000, height: 2000 }, { width: A4.height, height: A4.width });
    expect(s.height).toBeCloseTo(A4.width * 0.9, 6);
    expect(s.width).toBeCloseTo(s.height, 9);
  });

  it('takes the share it is given', () => {
    expect(fitToPage({ width: 1000, height: 1000 }, { width: 100, height: 100 }, 0.5)).toEqual({
      width: 50,
      height: 50,
    });
  });
});
