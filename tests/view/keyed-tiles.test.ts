// M12-12 (S27 finding 1): the keyed tile listener reaches two internals of
// the pinned @embedpdf/plugin-tiling (ADR-011). This fails when an upgrade
// renames them, so the workaround is looked at again (and, ideally, dropped
// once the plugin keys its own listener by document).
import { describe, expect, it, vi } from 'vitest';
import type { PluginRegistry } from '@embedpdf/core';
import { TilingPlugin } from '@embedpdf/plugin-tiling';
import { installKeyedTiles } from '../../src/features/view/keyedTiles';

describe('keyed tile listener (S27 finding 1)', () => {
  it('the pinned tiling plugin still has the internals it uses', () => {
    const proto = TilingPlugin.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.calculateVisibleTiles).toBe('function');
    // Built over a stand-in registry: it keeps the scroll capability and listens
    // to scrolling without a key per document (else the workaround can go).
    const calls: { options: Record<string, unknown> }[] = [];
    const scroll = {
      onScroll: (_l: unknown, options: Record<string, unknown>) => {
        calls.push({ options });
        return () => undefined;
      },
    };
    // Anything else the base class reaches for: a callable that gives itself back.
    const stub: unknown = new Proxy(() => stub, {
      get: (_t, key) => (key === 'then' ? undefined : stub),
    });
    const registry = new Proxy(
      {
        getPlugin: (id: string) => ({ provides: () => (id === 'scroll' ? scroll : stub) }),
      },
      { get: (t, key) => (key in t ? t[key as 'getPlugin'] : stub) },
    ) as unknown as PluginRegistry;
    const plugin = new TilingPlugin('tiling', registry, {
      tileSize: 768,
      overlapPx: 2.5,
      extraRings: 0,
    }) as unknown as {
      scrollCapability: unknown;
    };
    expect(plugin.scrollCapability).toBe(scroll);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({ mode: 'throttle', wait: 50 });
    expect(calls[0]?.options.keyExtractor).toBeUndefined();
  });

  it('calls the plugin for each document, keyed by document', () => {
    const calc = vi.fn();
    let options: unknown;
    let listener: ((e: { documentId: string; metrics: unknown }) => void) | undefined;
    const tiling = {
      calculateVisibleTiles: calc,
      scrollCapability: {
        onScroll: (l: typeof listener, o: unknown) => {
          listener = l;
          options = o;
          return () => undefined;
        },
      },
    };
    const registry = { getPlugin: () => tiling } as unknown as PluginRegistry;
    expect(installKeyedTiles(registry)).not.toBeNull();
    expect(options).toMatchObject({ mode: 'throttle', wait: 50 });
    const key = (options as { keyExtractor: (e: { documentId: string }) => string }).keyExtractor;
    expect(key({ documentId: 'B' })).toBe('B');
    listener?.({ documentId: 'A', metrics: 1 });
    expect(calc).toHaveBeenCalledWith('A', 1);
  });

  it('does nothing without the internals', () => {
    const registry = { getPlugin: () => ({}) } as unknown as PluginRegistry;
    expect(installKeyedTiles(registry)).toBeNull();
  });
});
