// "The user is scrolling, zooming or otherwise working the document" (M2-06,
// M2-08): background loaders (text indexing, thumbnails) back off while this
// is recent, so the visible tiles keep the Render worker and the CPU.
let last = -Infinity;
const listeners = new Set<() => void>();

export function noteActivity(now = performance.now()): void {
  last = now;
  for (const l of listeners) l();
}

/** True when nothing happened for `ms`. */
export function quietFor(ms: number, now = performance.now()): boolean {
  return now - last >= ms;
}

export function onActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
