import { describe, expect, it } from 'vitest';
import { CallOrder } from '../../src/workers/render/callOrder';

// M11-07: the Render worker's calls stay in arrival order while a comment's
// font loads; with nothing loading they start at once, as before.
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('CallOrder', () => {
  it('starts calls at once when nothing blocks', async () => {
    const order = new CallOrder();
    const seen: string[] = [];
    const a = order.run(async () => {
      await later(20);
      seen.push('a');
    }, false);
    const b = order.run(() => {
      seen.push('b');
    }, false);
    await Promise.all([a, b]);
    expect(seen).toEqual(['b', 'a']);
  });

  it('queues later calls behind a blocking one, in arrival order, and frees the queue after', async () => {
    const order = new CallOrder();
    const seen: string[] = [];
    const font = order.run(async () => {
      seen.push('font start');
      await later(20);
      seen.push('font end');
    }, true);
    const save = order.run(() => {
      seen.push('save');
      return 'saved';
    }, false);
    const edit = order.run(async () => {
      await later(5);
      seen.push('edit');
    }, false);
    expect(seen).toEqual(['font start']);
    await expect(save).resolves.toBe('saved');
    await Promise.all([font, edit]);
    expect(seen).toEqual(['font start', 'font end', 'save', 'edit']);
    // Drained: the next call starts at once again.
    await later(0);
    let ran = false;
    void order.run(() => {
      ran = true;
    }, false);
    expect(ran).toBe(true);
  });

  it('a failing call rejects only itself; the queue goes on', async () => {
    const order = new CallOrder();
    const bad = order.run(async () => {
      await later(5);
      throw new Error('no');
    }, true);
    const next = order.run(() => 1, false);
    await expect(bad).rejects.toThrow('no');
    await expect(next).resolves.toBe(1);
  });
});
