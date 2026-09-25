import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AbortError,
  RpcError,
  WorkerLostError,
  isAbortError,
  toErrorData,
} from '../../src/engine/errors';
import { Transfer, type MethodSpec } from '../../src/engine/protocol';
import { RpcClient } from '../../src/engine/rpc';
import { createThrottle, serve, type Handlers } from '../../src/workers/rpc-host';

interface TestApi {
  add: MethodSpec<{ a: number; b: number }, number>;
  fail: MethodSpec<{ kind: 'rpc' | 'plain' }, never>;
  waitForCancel: MethodSpec<null, string>;
  ignoreCancel: MethodSpec<{ ms: number }, string>;
  ticks: MethodSpec<{ ms: number; every: number }, number, number>;
  slow: MethodSpec<{ reportProgress: boolean }, null, number>;
  byteLength: MethodSpec<{ buf: ArrayBuffer }, number>;
  makeBuffer: MethodSpec<{ size: number }, { buf: ArrayBuffer }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

function setup(extra: Partial<Handlers<TestApi>> = {}, clock?: { t: number }) {
  const channel = new MessageChannel();
  channels.push(channel);
  const cancelled: string[] = [];
  const slowCalls: string[] = [];
  const handlers: Handlers<TestApi> = {
    add: ({ a, b }) => a + b,
    fail: ({ kind }) => {
      if (kind === 'rpc') throw new RpcError('needs-password', 'The document needs a password');
      throw new Error('secret page text from the document');
    },
    waitForCancel: (_args, ctx) =>
      new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => {
          cancelled.push('waitForCancel');
          resolve('saw abort');
        });
      }),
    ignoreCancel: async ({ ms }) => {
      await sleep(ms);
      return 'late';
    },
    ticks: async ({ ms, every }, ctx) => {
      const end = Date.now() + ms;
      let n = 0;
      while (Date.now() < end) {
        ctx.progress(++n);
        await sleep(every);
      }
      return n;
    },
    slow: ({ reportProgress }, ctx) => {
      if (reportProgress) ctx.progress(1);
      if (clock) clock.t += 500;
      return null;
    },
    byteLength: ({ buf }) => buf.byteLength,
    makeBuffer: ({ size }) => {
      const buf = new ArrayBuffer(size);
      return new Transfer({ buf }, [buf]);
    },
    ...extra,
  };
  serve<TestApi>(channel.port1, handlers, {
    onSlowWithoutProgress: (method) => slowCalls.push(method),
    ...(clock ? { now: () => clock.t } : {}),
  });
  const client = new RpcClient<TestApi>(channel.port2, 'test');
  return { client, cancelled, slowCalls, port: channel.port2 };
}

describe('RpcClient + serve', () => {
  it('round-trips a typed call', async () => {
    const { client } = setup();
    expect(await client.call('add', { a: 2, b: 3 }).promise).toBe(5);
  });

  it('is typed end to end', () => {
    const { client } = setup();
    // @ts-expect-error wrong argument type
    void client.call('add', { a: '2', b: 3 }).promise.catch(() => undefined);
    // @ts-expect-error unknown method
    void client.call('nope', {}).promise.catch(() => undefined);
    const n: Promise<number> = client.call('add', { a: 1, b: 1 }).promise;
    expect(n).toBeInstanceOf(Promise);
  });

  it('reports an unknown method with a code', async () => {
    const { client } = setup();
    const err = await client.call('nope' as 'add', { a: 1, b: 1 }).promise.catch((e: unknown) => e);
    expect((err as RpcError).code).toBe('unknown-method');
  });

  it('keeps our error codes and messages, but never another error’s message (rule 10)', async () => {
    const { client } = setup();
    const rpc = await client.call('fail', { kind: 'rpc' }).promise.catch((e: unknown) => e);
    expect(rpc).toBeInstanceOf(RpcError);
    expect((rpc as RpcError).code).toBe('needs-password');
    expect((rpc as RpcError).message).toBe('The document needs a password');

    const plain = await client.call('fail', { kind: 'plain' }).promise.catch((e: unknown) => e);
    expect((plain as RpcError).code).toBe('internal');
    expect((plain as RpcError).message).toBe('Error');
    expect(String((plain as RpcError).stack)).not.toContain('secret');
  });

  it('cancels a running call: the worker sees the abort, the caller gets AbortError', async () => {
    const { client, cancelled } = setup();
    const job = client.call('waitForCancel', null);
    await sleep(10);
    job.cancel();
    await expect(job.promise).rejects.toBeInstanceOf(AbortError);
    await sleep(10);
    expect(cancelled).toEqual(['waitForCancel']);
    expect(client.pendingCount).toBe(0);
  });

  it('cancels through an AbortSignal, including one aborted before the call', async () => {
    const { client } = setup();
    const ac = new AbortController();
    const job = client.call('waitForCancel', null, { signal: ac.signal });
    ac.abort();
    await expect(job.promise).rejects.toSatisfy(isAbortError);

    const pre = new AbortController();
    pre.abort();
    await expect(
      client.call('add', { a: 1, b: 1 }, { signal: pre.signal }).promise,
    ).rejects.toSatisfy(isAbortError);
  });

  it('rejects exactly once and drops a result that arrives after cancel', async () => {
    const { client } = setup();
    const job = client.call('ignoreCancel', { ms: 20 });
    const seen: string[] = [];
    job.promise.then(
      (v) => seen.push(`resolved ${v}`),
      (e: unknown) => seen.push(isAbortError(e) ? 'aborted' : 'other'),
    );
    job.cancel();
    job.cancel();
    await sleep(50);
    expect(seen).toEqual(['aborted']);
    expect(client.pendingCount).toBe(0);
  });

  it('throttles progress to at most one update per 100 ms', async () => {
    const { client } = setup();
    const times: number[] = [];
    const values: number[] = [];
    const job = client.call(
      'ticks',
      { ms: 450, every: 5 },
      {
        onProgress: (v) => {
          times.push(Date.now());
          values.push(v);
        },
      },
    );
    const total = await job.promise;
    expect(total).toBeGreaterThan(20);
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(90);
    }
  });

  it('flags a job over 300 ms that never reported progress (rule 2)', async () => {
    const clock = { t: 0 };
    const { client, slowCalls } = setup({}, clock);
    await client.call('slow', { reportProgress: false }).promise;
    await client.call('slow', { reportProgress: true }).promise;
    expect(slowCalls).toEqual(['slow']);
  });

  it('transfers buffers both ways without copying', async () => {
    const { client } = setup();
    const buf = new ArrayBuffer(1024);
    const len = await client.call('byteLength', { buf }, { transfer: [buf] }).promise;
    expect(len).toBe(1024);
    expect(buf.byteLength).toBe(0); // detached: it was moved, not copied

    const out = await client.call('makeBuffer', { size: 2048 }).promise;
    expect(out.buf.byteLength).toBe(2048);
  });

  it('rejects all pending calls with WorkerLostError when the worker is lost, and fails fast after', async () => {
    const { client, port } = setup();
    const a = client.call('waitForCancel', null);
    const b = client.call('waitForCancel', null);
    port.dispatchEvent(new Event('error'));
    await expect(a.promise).rejects.toBeInstanceOf(WorkerLostError);
    await expect(b.promise).rejects.toBeInstanceOf(WorkerLostError);
    expect(client.isLost).toBe(true);
    await expect(client.call('add', { a: 1, b: 1 }).promise).rejects.toBeInstanceOf(
      WorkerLostError,
    );
  });
});

describe('toErrorData', () => {
  it('reduces non-RpcErrors to their class name and stack frames', () => {
    const data = toErrorData(new TypeError('File "Q3 budget.pdf" is broken'));
    expect(data.code).toBe('internal');
    expect(data.message).toBe('TypeError');
    expect(data.stack ?? '').not.toContain('budget');
  });
  it('handles non-Error throws', () => {
    expect(toErrorData('oops')).toEqual({ code: 'internal', message: 'string' });
  });
});

describe('createThrottle', () => {
  it('emits immediately, then at most once per interval with the latest value', () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const out: number[] = [];
      const th = createThrottle<number>(
        100,
        (v) => out.push(v),
        () => t,
      );
      th.push(1); // immediate
      t = 10;
      th.push(2);
      t = 50;
      th.push(3); // replaces 2
      expect(out).toEqual([1]);
      t = 100;
      vi.advanceTimersByTime(100);
      expect(out).toEqual([1, 3]);
      th.push(4);
      th.cancel();
      vi.advanceTimersByTime(200);
      expect(out).toEqual([1, 3]);
    } finally {
      vi.useRealTimers();
    }
  });
});
