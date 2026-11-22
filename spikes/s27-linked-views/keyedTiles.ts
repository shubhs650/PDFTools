// Spike S27 finding (M12-02): @embedpdf/plugin-tiling 2.15.1 recalculates the
// visible tiles from ONE throttled scroll listener for every document
// (`scroll.onScroll(…, { mode: 'throttle', wait: 50, throttleMode: 'trailing' })`,
// no keyExtractor). When two windows scroll within 50 ms of each other, which
// linked windows always do, only the last document's tiles are recalculated
// and the other windows stay on their blurry previews. The zoom plugin keys
// its own throttle by document; tiling does not.
//
// Workaround measured here: a second listener keyed by document that calls
// the plugin's own calculateVisibleTiles (an internal of the pinned version,
// like the render queue ranker in src/features/view/tileScheduler.ts).
import type { PluginRegistry } from '@embedpdf/core';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';

interface TilingInternals {
  calculateVisibleTiles?: (documentId: string, metrics: unknown) => void;
  scrollCapability?: ScrollCapability;
}

interface ScrollEvent {
  documentId: string;
  metrics: unknown;
}
type KeyedOnScroll = (
  listener: (e: ScrollEvent) => void,
  options: {
    mode: 'throttle';
    wait: number;
    throttleMode: 'trailing';
    keyExtractor: (e: ScrollEvent) => string;
  },
) => () => void;

/** Returns the uninstaller, or null when the internals are not there. */
export function installKeyedTiles(registry: PluginRegistry): (() => void) | null {
  const tiling = registry.getPlugin('tiling') as unknown as TilingInternals | null;
  const calc = tiling?.calculateVisibleTiles?.bind(tiling);
  const onScroll = tiling?.scrollCapability?.onScroll as unknown as KeyedOnScroll | undefined;
  if (!calc || !onScroll) return null;
  return onScroll(
    (e) => {
      calc(e.documentId, e.metrics);
    },
    { mode: 'throttle', wait: 50, throttleMode: 'trailing', keyExtractor: (e) => e.documentId },
  );
}
