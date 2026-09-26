import { describe, expect, it } from 'vitest';
import { GrowthMemory, shouldOfferOptimize } from '../../src/features/save/growth';

const base = { signatureCount: 0, originalSize: 1000, appendedBytes: 0, dismissed: false };

describe('growth prompt rule (D-06, §4.2)', () => {
  it('offers Save Optimized once appended bytes exceed 30 % of the original', () => {
    expect(shouldOfferOptimize({ ...base, appendedBytes: 299 })).toBe(false);
    expect(shouldOfferOptimize({ ...base, appendedBytes: 300 })).toBe(false); // edge: not exceeded
    expect(shouldOfferOptimize({ ...base, appendedBytes: 301 })).toBe(true);
  });

  it('never for signed files (a rewrite would invalidate the signatures)', () => {
    expect(shouldOfferOptimize({ ...base, signatureCount: 1, appendedBytes: 5000 })).toBe(false);
  });

  it('not after the user dismissed it for this document', () => {
    expect(shouldOfferOptimize({ ...base, appendedBytes: 5000, dismissed: true })).toBe(false);
  });

  it('dismissal is remembered per document for the session', () => {
    const m = new GrowthMemory();
    m.dismiss('a');
    expect(m.isDismissed('a')).toBe(true);
    expect(m.isDismissed('b')).toBe(false);
    m.forget('a');
    expect(m.isDismissed('a')).toBe(false);
  });
});
