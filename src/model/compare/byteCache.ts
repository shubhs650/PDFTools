// A least-recently-used cache with a byte cap (M12-11; S29 risk 2: the
// overlay's grey tiles grew to 90 MB without one). Pure: used by the Render
// worker for the grey tiles of the overlay.

export class ByteCache<V> {
  private readonly items = new Map<string, { value: V; bytes: number }>();
  private total = 0;
  private readonly cap: number;

  constructor(capBytes: number) {
    this.cap = capBytes;
  }

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.items.size;
  }

  /** The value, now the most recently used; undefined when absent. */
  get(key: string): V | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    this.items.delete(key);
    this.items.set(key, hit);
    return hit.value;
  }

  /** Adds a value and evicts the least recently used ones over the cap (never the new one). */
  set(key: string, value: V, bytes: number): void {
    const old = this.items.get(key);
    if (old) {
      this.items.delete(key);
      this.total -= old.bytes;
    }
    this.items.set(key, { value, bytes });
    this.total += bytes;
    for (const [k, v] of this.items) {
      if (this.total <= this.cap || k === key) break;
      this.items.delete(k);
      this.total -= v.bytes;
    }
  }

  /** Removes every entry whose key starts with `prefix` (a document or a comparison closed). */
  dropPrefix(prefix: string): void {
    for (const [k, v] of this.items)
      if (k.startsWith(prefix)) {
        this.items.delete(k);
        this.total -= v.bytes;
      }
  }

  clear(): void {
    this.items.clear();
    this.total = 0;
  }
}
