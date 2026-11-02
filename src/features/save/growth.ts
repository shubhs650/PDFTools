// Growth prompt (D-06, §4.2, M1-23): repeated incremental saves grow a file.
// Once the bytes appended since open exceed 30 % of the original size, Ctrl+S
// offers "Save Optimized instead?". A change that rewrote page content (a
// flatten, M6-09, §7.1/§7.8 "optimize recommended") offers it too, whatever
// the growth. Never for signed files (a rewrite breaks the signatures); a
// dismissal lasts for the document's session.

export const GROWTH_RATIO = 0.3;

export interface GrowthInput {
  signatureCount: number;
  /** Size of the file the appended bytes are measured against (as opened or last optimized). */
  originalSize: number;
  appendedBytes: number;
  dismissed: boolean;
  /** Page content was rewritten since open or the last optimized save. */
  recommended?: boolean;
}

export function shouldOfferOptimize(i: GrowthInput): boolean {
  return (
    !i.dismissed &&
    i.signatureCount === 0 &&
    (i.recommended === true ||
      (i.originalSize > 0 && i.appendedBytes > GROWTH_RATIO * i.originalSize))
  );
}

/** Per-document "don't ask again" for the session. */
export class GrowthMemory {
  private readonly dismissed = new Set<string>();
  private readonly recommended = new Set<string>();

  /** Page content was rewritten (a flatten): Save Optimized is recommended. */
  recommend(docId: string): void {
    this.recommended.add(docId);
  }

  isRecommended(docId: string): boolean {
    return this.recommended.has(docId);
  }

  dismiss(docId: string): void {
    this.dismissed.add(docId);
  }

  isDismissed(docId: string): boolean {
    return this.dismissed.has(docId);
  }

  forget(docId: string): void {
    this.dismissed.delete(docId);
    this.recommended.delete(docId);
  }
}
