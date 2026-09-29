// Cooperative priority scheduler for the Work worker (ARCHITECTURE §3.1, §6;
// ADR-006 decision 3). The worker has one thread, so one job runs at a time.
// Long jobs call `checkpoint()` at every page boundary: there a waiting job of
// higher priority takes over, background work stays parked while a save is
// being verified, and cancellation is checked (CLAUDE.md rule 2). Every
// `yieldEveryMs` a job also lets a waiting job of the same priority take a
// turn, so a short request (hit rectangles, a page's text geometry) never
// waits for a whole-document search to finish.

import { AbortError } from '../../engine/errors';

// Snap geometry (M3-18, ADR-008) sits below interactive work and above
// background indexing; like interactive work it still runs during a save.
export type Priority = 'interactive' | 'save-verify' | 'geometry' | 'background';

const RANK: Record<Priority, number> = {
  interactive: 0,
  'save-verify': 1,
  geometry: 2,
  background: 3,
};

export interface JobSlice {
  /** Call between units of work (pages). May suspend; throws AbortError when cancelled. */
  checkpoint(): Promise<void>;
  readonly signal: AbortSignal;
}

interface Waiter {
  priority: Priority;
  seq: number;
  wake: () => void;
}

export class Scheduler {
  private running: { priority: Priority } | null = null;
  private readonly waiting: Waiter[] = [];
  private seq = 0;
  /** save-verify jobs queued or running: background may not run meanwhile. */
  private saves = 0;
  private readonly yieldEveryMs: number;
  private readonly now: () => number;
  private readonly sleep: () => Promise<void>;

  constructor(
    opts: { yieldEveryMs?: number; now?: () => number; sleep?: () => Promise<void> } = {},
  ) {
    this.yieldEveryMs = opts.yieldEveryMs ?? 8;
    this.now = opts.now ?? (() => performance.now());
    this.sleep = opts.sleep ?? (() => new Promise((r) => setTimeout(r, 0)));
  }

  /** Current state, for tests and diagnostics. */
  snapshot(): { running: Priority | null; waiting: Priority[]; savesActive: number } {
    return {
      running: this.running?.priority ?? null,
      waiting: this.sorted().map((w) => w.priority),
      savesActive: this.saves,
    };
  }

  async run<T>(
    priority: Priority,
    signal: AbortSignal,
    job: (slice: JobSlice) => Promise<T>,
  ): Promise<T> {
    if (priority === 'save-verify') this.saves++;
    try {
      await this.acquire(priority, signal);
      let lastYield = this.now();
      // A function, so the compiler doesn't narrow `aborted` across awaits.
      const check = (): void => {
        if (signal.aborted) throw new AbortError();
      };
      const slice: JobSlice = {
        signal,
        checkpoint: async () => {
          check();
          const pre = this.mustYield(priority);
          if (pre) {
            this.release();
            await this.acquire(priority, signal);
            lastYield = this.now();
          } else if (this.now() - lastYield >= this.yieldEveryMs) {
            // Let cancel and new-job messages in (they arrive as events).
            await this.sleep();
            lastYield = this.now();
            if (this.mustYield(priority, true)) {
              this.release();
              await this.acquire(priority, signal);
              lastYield = this.now();
            }
          }
          check();
        },
      };
      try {
        return await job(slice);
      } finally {
        this.release();
      }
    } finally {
      if (priority === 'save-verify') {
        this.saves--;
        this.dispatch();
      }
    }
  }

  private sorted(): Waiter[] {
    return [...this.waiting].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq);
  }

  private eligible(p: Priority): boolean {
    return !(p === 'background' && this.saves > 0);
  }

  /**
   * A waiting job outranks the running one (or, with `turns`, has the same
   * priority: round robin), or background must park for a save.
   */
  private mustYield(p: Priority, turns = false): boolean {
    if (!this.eligible(p)) return true;
    return this.waiting.some(
      (w) =>
        (RANK[w.priority] < RANK[p] || (turns && RANK[w.priority] === RANK[p])) &&
        this.eligible(w.priority),
    );
  }

  private acquire(priority: Priority, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new AbortError());
    if (
      !this.running &&
      this.eligible(priority) &&
      !this.waiting.some((w) => this.eligible(w.priority) && RANK[w.priority] <= RANK[priority])
    ) {
      this.running = { priority };
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const w: Waiter = {
        priority,
        seq: this.seq++,
        wake: () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      const onAbort = (): void => {
        const i = this.waiting.indexOf(w);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(new AbortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(w);
    });
  }

  private release(): void {
    this.running = null;
    this.dispatch();
  }

  private dispatch(): void {
    if (this.running) return;
    const next = this.sorted().find((w) => this.eligible(w.priority));
    if (!next) return;
    this.waiting.splice(this.waiting.indexOf(next), 1);
    this.running = { priority: next.priority };
    next.wake();
  }
}
