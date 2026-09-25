// Memory policy for the PDFium workers (ADR-004 decision 4, ARCHITECTURE §3.1).
// WASM memory only grows, so the only way to give it back is a fresh worker.

/** Work worker: respawn when idle after a job whose peak exceeded this (≈256 MB). */
export const WORK_RESPAWN_BYTES = 256 * 1024 * 1024;

export interface WorkRespawnInput {
  /** WASM memory after the last job. */
  wasmBytes: number;
  /** Jobs still running or queued. */
  pendingJobs: number;
  /** A document was evicted since the last respawn. */
  evicted: boolean;
  thresholdBytes?: number;
}

/** Respawn the Work worker? Only when idle, and only if memory is high or a document was evicted. */
export function shouldRespawnWork(i: WorkRespawnInput): boolean {
  if (i.pendingJobs > 0) return false;
  return i.evicted || i.wasmBytes > (i.thresholdBytes ?? WORK_RESPAWN_BYTES);
}

/** Respawn the Render worker? Only when no document is open (it owns the authoritative copies). */
export function shouldRespawnRender(i: {
  openDocuments: number;
  wasmBytes: number;
  thresholdBytes?: number;
}): boolean {
  return i.openDocuments === 0 && i.wasmBytes > (i.thresholdBytes ?? WORK_RESPAWN_BYTES);
}
