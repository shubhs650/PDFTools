// Recovery snapshot types (§4.3), shared by the storage worker (opfs.ts) and
// its main-thread callers without pulling worker-only APIs into their types.

export type TailSlot = 'a' | 'b';

/** Small, content-free UI state saved with a snapshot (§4.3: tab order, page, zoom). */
export type UiState = Record<string, string | number | boolean | null>;

export interface RecoveryMeta {
  v: 1;
  fp: string;
  /** Set once the original is fully written. */
  originalBytes?: number;
  tail?: { slot: TailSlot; bytes: number };
  ui?: UiState;
  /** Epoch ms of the last write. */
  updated: number;
}

export interface Snapshot {
  fp: string;
  originalBytes: number;
  tailBytes: number;
  ui: UiState | undefined;
  updated: number;
}

/** OPFS directory of the recovery snapshots (opfs.ts; listed on the Privacy page, M1-26). */
export const RECOVERY_DIR = 'recovery';
