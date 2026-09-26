import { describe, expect, it } from 'vitest';
import { isAbortError } from '../../src/engine/errors';
import { Scheduler, type JobSlice, type Priority } from '../../src/workers/work/scheduler';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A job of `pages` units that logs each unit and checkpoints between them. */
function job(log: string[], name: string, pages: number) {
  return async (s: JobSlice) => {
    for (let i = 0; i < pages; i++) {
      await s.checkpoint();
      log.push(`${name}${String(i)}`);
      await tick();
    }
    return name;
  };
}

describe('Work-worker scheduler', () => {
  it('runs one job at a time, FIFO within a priority', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const ac = new AbortController();
    await Promise.all([
      s.run('interactive', ac.signal, job(log, 'a', 2)),
      s.run('interactive', ac.signal, job(log, 'b', 2)),
    ]);
    expect(log).toEqual(['a0', 'a1', 'b0', 'b1']);
  });

  it('a higher-priority job preempts background work at the next page boundary', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const ac = new AbortController();
    const bg = s.run('background', ac.signal, job(log, 'bg', 5));
    await tick();
    await tick();
    const fg = s.run('interactive', ac.signal, job(log, 'fg', 2));
    await Promise.all([bg, fg]);
    const firstFg = log.indexOf('fg0');
    expect(firstFg).toBeGreaterThan(0);
    expect(firstFg).toBeLessThan(log.indexOf('bg4'));
    // fg ran to completion before bg resumed
    expect(log.indexOf('fg1')).toBe(firstFg + 1);
  });

  it('parks background jobs while a save is being verified', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const ac = new AbortController();
    const save = s.run('save-verify', ac.signal, job(log, 's', 3));
    const bg = s.run('background', ac.signal, job(log, 'bg', 2));
    await Promise.all([save, bg]);
    expect(log).toEqual(['s0', 's1', 's2', 'bg0', 'bg1']);
  });

  it('orders interactive > save-verify > background when several wait', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const ac = new AbortController();
    const order: Priority[] = [];
    const first = s.run('interactive', ac.signal, async (sl) => {
      await sl.checkpoint();
      await tick();
      return 'x';
    });
    const runs = (['background', 'save-verify', 'interactive'] as const).map((p) =>
      s.run(p, ac.signal, () => {
        order.push(p);
        return Promise.resolve(p);
      }),
    );
    await Promise.all([first, ...runs]);
    expect(order).toEqual(['interactive', 'save-verify', 'background']);
    expect(log).toEqual([]);
  });

  it('cancels a running job at its next checkpoint, and a waiting job immediately', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const a = new AbortController();
    const b = new AbortController();
    const running = s.run('interactive', a.signal, job(log, 'a', 50));
    const waiting = s.run('interactive', b.signal, job(log, 'b', 1));
    b.abort();
    await expect(waiting).rejects.toSatisfy(isAbortError);
    await tick();
    a.abort();
    await expect(running).rejects.toSatisfy(isAbortError);
    expect(log.length).toBeLessThan(50);
    expect(s.snapshot()).toEqual({ running: null, waiting: [], savesActive: 0 });
    // the scheduler is usable afterwards
    expect(
      await s.run('background', new AbortController().signal, () => Promise.resolve('ok')),
    ).toBe('ok');
  });

  it('yields to the event loop at least every yieldEveryMs even without competition', async () => {
    let t = 0;
    let sleeps = 0;
    const s = new Scheduler({
      yieldEveryMs: 8,
      now: () => t,
      sleep: () => {
        sleeps++;
        return Promise.resolve();
      },
    });
    await s.run('background', new AbortController().signal, async (sl) => {
      for (let i = 0; i < 10; i++) {
        t += 5;
        await sl.checkpoint();
      }
    });
    expect(sleeps).toBe(5);
  });

  it('a short job of the same priority gets a turn within yieldEveryMs (round robin)', async () => {
    let t = 0;
    const s = new Scheduler({ yieldEveryMs: 8, now: () => t, sleep: tick });
    const log: string[] = [];
    const ac = new AbortController();
    const long = s.run('interactive', ac.signal, async (sl) => {
      for (let i = 0; i < 20; i++) {
        await sl.checkpoint();
        t += 5; // 5 ms per page
        log.push(`search${String(i)}`);
      }
    });
    await tick();
    const short = s.run('interactive', ac.signal, () => {
      log.push('rects');
      return Promise.resolve();
    });
    await Promise.all([long, short]);
    expect(log.indexOf('rects')).toBeGreaterThan(0);
    expect(log.indexOf('rects')).toBeLessThan(5); // not after the 20 pages
    expect(log.filter((x) => x.startsWith('search'))).toHaveLength(20);
  });
});
