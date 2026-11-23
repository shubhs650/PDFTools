// Page mounts without a quadratic cost (rule 1, M12-19): the pinned
// @embedpdf/plugin-interaction-manager 2.15.1 emits `onHandlerChange` once for
// every handler a page registers (one per comment tool, and more), and every
// mounted page's pointer provider then merges its handlers again. A jump that
// mounts five new pages next to the ten already mounted therefore does
// hundreds of merges in one task; with two windows of a text comparison
// open, a jump far down the documents went over 100 ms on CI. The emits of
// one task are joined into one, on a microtask: handlers are registered and
// removed in React's commit, and no pointer event can come before the
// microtask runs. It reaches an internal of the pinned version, like
// keyedTiles.ts; tests/view/handler-batch.test.ts fails when an upgrade
// changes it.
import type { PluginRegistry } from '@embedpdf/core';

interface Emitter {
  emit: (value?: unknown) => void;
}

interface InteractionManagerInternals {
  onHandlerChange$?: Emitter;
  state?: unknown;
}

/** Joins the handler-change emits of one task; returns the remover, or null without the internals. */
export function installHandlerBatch(registry: PluginRegistry): (() => void) | null {
  const im = registry.getPlugin(
    'interaction-manager',
  ) as unknown as InteractionManagerInternals | null;
  const emitter = im?.onHandlerChange$;
  if (!im || !emitter || typeof emitter.emit !== 'function') return null;
  const raw = emitter.emit;
  let queued = false;
  const batched = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const s = im.state;
      raw(s && typeof s === 'object' ? { ...s } : s);
    });
  };
  emitter.emit = batched;
  return () => {
    if (emitter.emit === batched) emitter.emit = raw;
  };
}
