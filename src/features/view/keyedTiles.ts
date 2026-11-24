// Sharp tiles in several windows at once (S27 finding 1, M12-12): the pinned
// @embedpdf/plugin-tiling 2.15.1 recalculates the visible tiles from ONE
// throttled scroll listener for every document (`throttle`, 50 ms, trailing,
// no `keyExtractor`). When two windows scroll within 50 ms of each other,
// which linked comparison windows always do, only the last document's tiles
// are recalculated and the other windows stay on their blurry previews. A
// second listener keyed by document calls the plugin's own
// `calculateVisibleTiles` for each. It reaches an internal of the pinned
// version, like the render queue ranker (tileScheduler.ts, ADR-011);
// tests/view/keyed-tiles.test.ts fails when an upgrade changes it.
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

/** Installs the keyed listener; returns the remover, or null when the internals are not there. */
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

interface RetileInternals {
  recalculateTiles?: (payload: { documentId: string; pageIndexes: number[] }) => unknown;
}

/**
 * Draws every open document's visible tiles again (Thin Lines turned on or off,
 * M13-05): the plugin's own refresh, which gives the tiles new ids, without
 * EmbedPDF's REFRESH_PAGES (that also reloads each page's text geometry, a Work
 * worker job per page). Off-screen pages draw fresh when they come into view.
 * Returns false when the internal is not there (the caller refreshes pages).
 */
export function retileAll(registry: PluginRegistry): boolean {
  const tiling = registry.getPlugin('tiling') as unknown as RetileInternals | null;
  const recalc = tiling?.recalculateTiles?.bind(tiling);
  if (!recalc) return false;
  const docs = registry.getStore().getState().core.documents;
  for (const [documentId, d] of Object.entries(docs)) {
    const count = d.document?.pageCount ?? 0;
    if (count > 0)
      void recalc({ documentId, pageIndexes: Array.from({ length: count }, (_, i) => i) });
  }
  return true;
}
