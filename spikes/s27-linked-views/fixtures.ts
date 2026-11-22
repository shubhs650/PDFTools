// Shared facts of the S27 fixtures (make-fixtures.ts), read by the page and the tests.

/** ISO A0 landscape, millimetres. */
export const A0 = { wMm: 1189, hMm: 841 } as const;

/**
 * a0-c.pdf is a0-b.pdf's drawing moved by this similarity in PDF user space
 * (points, origin bottom-left): p' = k·R(deg)·p + (tx, ty).
 */
export const A0_LINK = { k: 0.96, deg: 0.6, tx: 40, ty: -25 } as const;

/** Corpus pair 15: Rev B is Rev A (A1) fitted and centred on A3 (the generator's facts). */
export const A1_PT = { w: (841 * 72) / 25.4, h: (594 * 72) / 25.4 };
export const A3_PT = { w: (420 * 72) / 25.4, h: (297 * 72) / 25.4 };
