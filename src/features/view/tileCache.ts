// Bounded image cache for rendered tiles and previews (§5: "tile cache bounded
// per document (LRU); off-screen documents drop tiles first"). Holds encoded
// Blobs (a few KB–1 MB each), keyed by the exact render request, so scrolling
// back or switching tabs shows images without a new render.
//
// Eviction: least recently used entries of inactive documents first, then of
// the active one. Entries are dropped with their document on close.
//
// M3 (annotation edits) must call dropPage() for a page whose content changes.

export const TILE_CACHE_BYTES = 64 * 1024 * 1024;

interface Entry {
  docId: string;
  pageIndex: number;
  blob: Blob;
}

export class TileCache {
  /** Map iteration order is insertion order: re-inserting on use makes it LRU. */
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private active: string | null = null;
  readonly maxBytes: number;
  hits = 0;
  evictions = 0;

  constructor(maxBytes = TILE_CACHE_BYTES) {
    this.maxBytes = maxBytes;
  }

  get size(): number {
    return this.bytes;
  }

  get count(): number {
    return this.entries.size;
  }

  get(key: string): Blob | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    this.entries.set(key, e);
    this.hits++;
    return e.blob;
  }

  set(key: string, docId: string, pageIndex: number, blob: Blob): void {
    if (blob.size > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.blob.size;
      this.entries.delete(key);
    }
    this.entries.set(key, { docId, pageIndex, blob });
    this.bytes += blob.size;
    this.evict();
  }

  /** The document shown in the active tab; the others are evicted first. */
  setActive(docId: string | null): void {
    this.active = docId;
  }

  dropDoc(docId: string): void {
    this.dropWhere((e) => e.docId === docId);
  }

  dropPage(docId: string, pageIndex: number): void {
    this.dropWhere((e) => e.docId === docId && e.pageIndex === pageIndex);
  }

  docBytes(docId: string): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.docId === docId) n += e.blob.size;
    return n;
  }

  private dropWhere(pred: (e: Entry) => boolean): void {
    for (const [key, e] of this.entries) {
      if (!pred(e)) continue;
      this.entries.delete(key);
      this.bytes -= e.blob.size;
    }
  }

  private evict(): void {
    if (this.bytes <= this.maxBytes) return;
    // Inactive documents first (oldest first), then the active one.
    for (const pass of [(e: Entry) => e.docId !== this.active, () => true]) {
      for (const [key, e] of this.entries) {
        if (this.bytes <= this.maxBytes) return;
        if (!pass(e)) continue;
        this.entries.delete(key);
        this.bytes -= e.blob.size;
        this.evictions++;
      }
    }
  }
}
