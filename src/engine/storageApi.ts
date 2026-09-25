// Storage worker API (ARCHITECTURE §4.3, §10.3; M1-12). OPFS recovery
// snapshots and document fingerprints, off the main thread (rule 1).
import type { Snapshot, UiState } from '../storage/opfs';
import type { MethodSpec } from './protocol';

export interface StorageApi {
  /** SHA-256 fingerprint of a file (fingerprint.ts). Blobs cross without a copy. */
  fingerprint: MethodSpec<{ file: Blob }, string>;
  /** Stores the original once; returns its size. Progress in bytes. */
  putOriginal: MethodSpec<
    { fp: string; source: Blob | ArrayBuffer },
    number,
    { done: number; total: number }
  >;
  writeTail: MethodSpec<{ fp: string; tail: ArrayBuffer; ui?: UiState }, null>;
  writeUiState: MethodSpec<{ fp: string; ui: UiState }, null>;
  list: MethodSpec<null, Snapshot[]>;
  read: MethodSpec<{ fp: string }, { original: ArrayBuffer; tail: ArrayBuffer; ui?: UiState }>;
  discard: MethodSpec<{ fp: string }, null>;
  clearAll: MethodSpec<null, null>;
}
