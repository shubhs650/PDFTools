// M12-19 (rule 1): the handler-change emits of one task are joined into one.
// It reaches an internal of the pinned @embedpdf/plugin-interaction-manager;
// this fails when an upgrade renames it, so the workaround is looked at again
// (and dropped once the plugin batches its own emits).
import { describe, expect, it, vi } from 'vitest';
import type { PluginRegistry } from '@embedpdf/core';
import { InteractionManagerPlugin } from '@embedpdf/plugin-interaction-manager';
import { installHandlerBatch } from '../../src/features/view/handlerBatch';

const tick = (): Promise<void> => Promise.resolve();

describe('handler-change batching', () => {
  it('the pinned interaction manager still emits once per registration', () => {
    // Anything the base class reaches for: a callable that gives itself back.
    const stub: unknown = new Proxy(() => stub, {
      get: (_t, key) => (key === 'then' ? undefined : stub),
    });
    const registry = stub as PluginRegistry;
    const plugin = new InteractionManagerPlugin('interaction-manager', registry, {}) as unknown as {
      onHandlerChange$: { emit: unknown };
      registerHandlers: unknown;
    };
    expect(typeof plugin.onHandlerChange$.emit).toBe('function');
    expect(String(plugin.registerHandlers)).toContain('onHandlerChange$.emit');
  });

  it('joins the emits of one task into one, with the state as it is then', async () => {
    const seen: unknown[] = [];
    const raw = vi.fn((v?: unknown) => seen.push(v));
    const im = { onHandlerChange$: { emit: raw }, state: { n: 1 } };
    const registry = { getPlugin: () => im } as unknown as PluginRegistry;
    const remove = installHandlerBatch(registry);
    expect(remove).not.toBeNull();
    im.onHandlerChange$.emit({ n: 1 });
    im.onHandlerChange$.emit({ n: 1 });
    im.state = { n: 2 };
    im.onHandlerChange$.emit({ n: 2 });
    expect(raw).not.toHaveBeenCalled();
    await tick();
    expect(raw).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ n: 2 }]);
    // The next task's emits are one more.
    im.onHandlerChange$.emit();
    await tick();
    expect(raw).toHaveBeenCalledTimes(2);
    remove?.();
    im.onHandlerChange$.emit('x');
    expect(raw).toHaveBeenLastCalledWith('x');
  });

  it('does nothing without the internals', () => {
    const registry = { getPlugin: () => ({}) } as unknown as PluginRegistry;
    expect(installHandlerBatch(registry)).toBeNull();
  });
});
