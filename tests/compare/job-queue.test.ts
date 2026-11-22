// M12-07 (D-66): the comparison's job queue — what the user views goes first,
// a few tasks at a time, dependencies, progress, failures and Cancel.
import { describe, expect, it } from 'vitest';
import { AbortError, isAbortError } from '../../src/engine/errors';
import { CompareQueue, type QueueTask } from '../../src/features/compare/engine/jobQueue';

/** A task whose completion the test controls. */
function gate() {
  let open: (v?: unknown) => void = () => undefined;
  let fail: (e: Error) => void = () => undefined;
  const promise = new Promise<unknown>((res, rej) => {
    open = res;
    fail = rej;
  });
  return { promise, open, fail };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function recorder(log: string[], result: (key: string) => unknown = (k) => k) {
  return (key: string, sheet: number | null, phase = 0, after?: string[]): QueueTask => ({
    key,
    sheet,
    phase,
    ...(after ? { after } : {}),
    run: () => {
      log.push(key);
      return Promise.resolve(result(key));
    },
  });
}

describe('CompareQueue', () => {
  it('runs every task once and reports each result', async () => {
    const log: string[] = [];
    const results: [string, unknown][] = [];
    const q = new CompareQueue({ onResult: (k, v) => results.push([k, v]) });
    const t = recorder(log);
    q.add([t('a', 0), t('b', 1), t('c', 2)]);
    await q.whenIdle();
    expect([...log].sort()).toEqual(['a', 'b', 'c']);
    expect(results.map(([k]) => k).sort()).toEqual(['a', 'b', 'c']);
    expect(q.progress()).toEqual({ done: 3, failed: 0, total: 3, running: 0 });
  });

  it('runs at most `concurrency` tasks at once', async () => {
    const gates = [gate(), gate(), gate(), gate()];
    let inFlight = 0;
    let peak = 0;
    const q = new CompareQueue({ concurrency: 2 });
    q.add(
      gates.map((g, i) => ({
        key: `t${String(i)}`,
        sheet: i,
        phase: 0,
        run: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await g.promise;
          inFlight--;
        },
      })),
    );
    expect(q.progress().running).toBe(2);
    for (const g of gates) {
      g.open();
      await flush();
    }
    await q.whenIdle();
    expect(peak).toBe(2);
  });

  it('puts the viewed sheet first, then the sheets after it, then the ones before', async () => {
    const log: string[] = [];
    const q = new CompareQueue({ concurrency: 1 });
    const t = recorder(log);
    const block = gate();
    // A running task holds the only slot while the order is set.
    q.add([{ key: 'hold', sheet: null, phase: 0, run: () => block.promise }]);
    q.add([0, 1, 2, 3, 4, 5].map((s) => t(`s${String(s)}`, s, 1)));
    q.focus(3);
    expect(q.readyOrder()).toEqual(['s3', 's4', 's5', 's2', 's1', 's0']);
    block.open();
    await q.whenIdle();
    expect(log).toEqual(['s3', 's4', 's5', 's2', 's1', 's0']);
  });

  it('a change of focus reorders what has not started yet', async () => {
    const log: string[] = [];
    const gates = new Map<string, ReturnType<typeof gate>>();
    const q = new CompareQueue({ concurrency: 1 });
    q.add(
      [0, 1, 2, 3, 4].map((s) => {
        const key = `s${String(s)}`;
        const g = gate();
        gates.set(key, g);
        return {
          key,
          sheet: s,
          phase: 0,
          run: () => {
            log.push(key);
            return g.promise;
          },
        };
      }),
    );
    expect(log).toEqual(['s0']);
    q.focus(4); // the user turned to the last sheet while s0 runs
    gates.get('s0')?.open();
    await flush();
    expect(log).toEqual(['s0', 's4']);
    for (const g of gates.values()) g.open();
    await q.whenIdle();
    // Then the sheets before it, nearest first.
    expect(log).toEqual(['s0', 's4', 's3', 's2', 's1']);
  });

  it('without a focus, a lower phase runs first and whole-comparison work leads its phase', async () => {
    const log: string[] = [];
    const q = new CompareQueue({ concurrency: 1 });
    const t = recorder(log);
    const block = gate();
    q.add([{ key: 'hold', sheet: null, phase: 9, run: () => block.promise }]);
    q.add([t('sheet1', 1, 1), t('read1', 1, 0), t('read0', 0, 0), t('pairing', null, 0)]);
    expect(q.readyOrder()).toEqual(['pairing', 'read0', 'read1', 'sheet1']);
    block.open();
    await q.whenIdle();
  });

  it('the viewed sheet goes ahead of an earlier phase of other sheets', () => {
    const q = new CompareQueue({ concurrency: 1 });
    const block = gate();
    q.add([{ key: 'hold', sheet: null, phase: 0, run: () => block.promise }]);
    const t = recorder([]);
    q.add([t('read0', 0, 0), t('read1', 1, 0), t('sheet1', 1, 1)]);
    q.focus(1);
    expect(q.readyOrder()).toEqual(['read1', 'sheet1', 'read0']);
    block.open();
  });

  it('while the viewed sheet works, the free slot waits for it instead of starting another sheet', async () => {
    const log: string[] = [];
    const viewed = gate();
    const q = new CompareQueue({ concurrency: 2 });
    q.focus(2);
    q.add([
      {
        key: 'view',
        sheet: 2,
        phase: 1,
        run: () => {
          log.push('view');
          return viewed.promise;
        },
      },
      recorder(log)('other', 0, 1),
      recorder(log)('whole', null, 1),
    ]);
    await flush();
    // Whole-comparison work may share the worker; another sheet may not.
    expect(log).toEqual(['view', 'whole']);
    expect(q.state('other')).toBe('pending');
    viewed.open();
    await q.whenIdle();
    expect(log).toEqual(['view', 'whole', 'other']);
  });

  it('waits for dependencies', async () => {
    const log: string[] = [];
    const q = new CompareQueue({ concurrency: 4 });
    const t = recorder(log);
    q.add([t('sheet0', 0, 1, ['readA0', 'readB0']), t('readA0', 0, 0), t('readB0', 0, 0)]);
    await q.whenIdle();
    expect(log.indexOf('sheet0')).toBe(2);
  });

  it('a failed task fails the tasks that wait for it, and the rest still run', async () => {
    const errors: [string, string][] = [];
    const log: string[] = [];
    const q = new CompareQueue({
      concurrency: 1,
      onError: (k, e) => errors.push([k, e.message]),
    });
    const t = recorder(log);
    q.add([
      {
        key: 'bad',
        sheet: 0,
        phase: 0,
        run: () => Promise.reject(new Error('broken page')),
      },
      t('needsBad', 0, 1, ['bad']),
      t('fine', 1, 0),
    ]);
    await q.whenIdle();
    expect(log).toEqual(['fine']);
    expect(errors.map(([k]) => k)).toEqual(['bad', 'needsBad']);
    expect(q.state('needsBad')).toBe('failed');
    expect(q.progress()).toEqual({ done: 1, failed: 2, total: 3, running: 0 });
  });

  it('a task that waits for an unknown key fails at once', () => {
    const errors: string[] = [];
    const q = new CompareQueue({ onError: (k) => errors.push(k) });
    q.add([recorder([])('x', 0, 0, ['missing'])]);
    expect(errors).toEqual(['x']);
  });

  it('a synchronous throw is a failure, not a crash', async () => {
    const errors: string[] = [];
    const q = new CompareQueue({ onError: (k) => errors.push(k) });
    q.add([
      {
        key: 'boom',
        sheet: 0,
        phase: 0,
        run: () => {
          throw new Error('sync');
        },
      },
    ]);
    await q.whenIdle();
    expect(errors).toEqual(['boom']);
  });

  it('cancel aborts running tasks, drops pending ones and reports no late result', async () => {
    const results: string[] = [];
    const errors: string[] = [];
    const signals: AbortSignal[] = [];
    const q = new CompareQueue({
      concurrency: 2,
      onResult: (k) => results.push(k),
      onError: (k) => errors.push(k),
    });
    const late = gate();
    q.add([
      {
        key: 'aborts',
        sheet: 0,
        phase: 0,
        run: (signal) => {
          signals.push(signal);
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              reject(new AbortError());
            });
          });
        },
      },
      // Ignores its signal and finishes after the cancel: its result is dropped.
      { key: 'ignores', sheet: 1, phase: 0, run: () => late.promise },
      { key: 'pending', sheet: 2, phase: 0, run: () => Promise.resolve('never') },
    ]);
    q.cancel();
    expect(signals[0]?.aborted).toBe(true);
    late.open('too late');
    await q.whenIdle();
    expect(results).toEqual([]);
    expect(errors).toEqual([]);
    expect(q.progress()).toEqual({ done: 0, failed: 0, total: 0, running: 0 });
    expect(() => {
      q.add([recorder([])('after', 0)]);
    }).toThrow(expect.objectContaining({ code: 'aborted' }) as Error);
  });

  it('reports progress as tasks finish', async () => {
    const seen: string[] = [];
    const q = new CompareQueue({
      concurrency: 1,
      onProgress: (p) => seen.push(`${String(p.done)}/${String(p.total)}`),
    });
    const t = recorder([]);
    q.add([t('a', 0), t('b', 1)]);
    await q.whenIdle();
    expect(seen.at(-1)).toBe('2/2');
    expect(seen).toContain('1/2');
  });

  it('rejects duplicate keys', () => {
    const q = new CompareQueue();
    const t = recorder([]);
    expect(() => {
      q.add([t('a', 0), t('a', 1)]);
    }).toThrow(/duplicate/);
  });

  it('whenIdle resolves at once on an empty queue', async () => {
    await expect(new CompareQueue().whenIdle()).resolves.toBeUndefined();
    expect(isAbortError(new AbortError())).toBe(true);
  });
});
