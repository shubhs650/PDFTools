// Snap worker (M3-18, ARCHITECTURE §3.1, ADR-008 decision 2): pure JS, no
// PDFium. Holds the per-page snap indexes transferred from the Work worker and
// answers pointer queries (≤ 1 in flight per frame, snapping.ts), so a query
// never waits behind a page parse.
import type { SnapApi } from '../engine/snapApi';
import { snap, type GridIndex } from '../model/snapIndex';
import { serve } from './rpc-host';

const indexes = new Map<string, GridIndex>();
/** Candidate de-duplication scratch, reused across queries (no per-query Set). */
let seen = new Uint32Array(1);
let stamp = 0;

serve<SnapApi>(self, {
  load: ({ key, index }) => {
    indexes.set(key, index);
    const n = index.segs.length / 4;
    if (seen.length < n) seen = new Uint32Array(n);
    return { segments: n };
  },
  drop: ({ prefix }) => {
    for (const key of [...indexes.keys()]) if (key.startsWith(prefix)) indexes.delete(key);
    return null;
  },
  snap: ({ key, x, y, r, kinds }) => {
    const g = indexes.get(key);
    if (!g) return null;
    stamp = (stamp + 1) >>> 0;
    if (stamp === 0) {
      seen.fill(0);
      stamp = 1;
    }
    return snap(g, x, y, r, new Set(kinds), 2048, seen, stamp);
  },
});
