// M0-S7 snap worker: pure JS, no PDFium. Holds transferred page indexes and
// answers pointer queries, so they never wait behind PDFium work.

import { serve } from '../s3-two-engines/rpc.ts';
import { snap, type GridIndex } from './snap-core.ts';

const indexes = new Map<number, GridIndex>();
let seen = new Uint32Array(1);
let stamp = 0;

const handlers = {
  load(args: { page: number; index: GridIndex }) {
    indexes.set(args.page, args.index);
    if (seen.length < args.index.segs.length / 4)
      seen = new Uint32Array(args.index.segs.length / 4);
    return { segments: args.index.segs.length / 4 };
  },
  snap(args: { page: number; x: number; y: number; r: number }) {
    const g = indexes.get(args.page);
    return g ? snap(g, args.x, args.y, args.r, 2048, seen, ++stamp) : null;
  },
};

export type SnapHandlers = typeof handlers;
serve(handlers);
