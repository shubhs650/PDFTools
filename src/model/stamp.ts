// Dynamic stamps (M3-14, §7.3, ADR-015 decision 1): the text a stamp carries —
// drawn into a PNG in the stamp worker, and written to /Subj and /Contents so
// it is searchable and listed in other viewers' comment panes. Pure.

/** The placed size of a dynamic stamp, in points; the PNG is drawn at 4× (ADR-015). */
export const STAMP_SIZE = { width: 170, height: 60 } as const;
export const STAMP_SCALE = 4;

/** Image stamps: the longer side on the page, in points. */
export const IMAGE_STAMP_MAX = 200;

/** Largest image or PDF file accepted as an image stamp. */
export const IMAGE_STAMP_MAX_BYTES = 20 * 1024 * 1024;

export interface StampInput {
  code: string;
  label: string;
  reviewer: string;
  /** Already formatted in the user's locale. */
  date: string;
  docNo: string;
  rev: string;
}

export interface StampText {
  /** Up to three lines, largest first. */
  lines: string[];
  subject: string;
  contents: string;
}

export function stampText(s: StampInput): StampText {
  const head = `${s.code}  ${s.label}`.trim();
  const who = [s.reviewer.trim(), s.date.trim()].filter(Boolean).join(' · ');
  const doc = [s.docNo.trim(), s.rev.trim() ? `Rev. ${s.rev.trim()}` : '']
    .filter(Boolean)
    .join(' · ');
  const lines = [head, who, doc].filter(Boolean);
  return {
    lines,
    subject: `${s.code} ${s.label}`.trim(),
    contents: [`${s.code} ${s.label}`.trim(), who, doc].filter(Boolean).join('\n'),
  };
}

/** Han, kana or Hangul: the stamp worker loads a CJK face for these. */
export const needsCjk = (text: string): boolean => /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/u.test(text);

export function fitWithin(
  size: { width: number; height: number },
  max: number,
): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(size.width, size.height));
  return { width: size.width * k, height: size.height * k };
}
