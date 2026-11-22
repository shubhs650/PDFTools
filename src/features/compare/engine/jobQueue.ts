// The comparison's job queue (M12-07, D-66, plan "Speed, progress and
// acceptance"): results arrive as they are ready, what the user is looking
// at is worked on first, and progress and Cancel are always there (rule 2).
//
// Each task serves one sheet (or none), belongs to a phase (reading before
// sheets) and may wait for other tasks. A few run at a time (the Work worker
// is one thread: two in flight keep it busy while the Compare worker folds
// the last result in). While the viewed sheet has work running, the other
// slots wait for its next task rather than start another sheet's, so the
// viewed sheet gets the whole Work worker. Changing the focus reorders what
// has not started.
// Pure orchestration: the tasks themselves call the workers.
import { AbortError, RpcError, isAbortError } from '../../../engine/errors';

export interface QueueTask<R = unknown> {
  /** Unique within the queue. */
  key: string;
  /** The sheet (or page) the task serves; null for work of the whole comparison. */
  sheet: number | null;
  /** Lower phases run first (for example 0 = read pages, 1 = sheets). */
  phase: number;
  /** Keys that must finish first. A failed one fails this task too. */
  after?: string[];
  run(signal: AbortSignal): Promise<R>;
}

export interface QueueProgress {
  done: number;
  failed: number;
  total: number;
  running: number;
}

export interface QueueOptions {
  /** Tasks in flight at once (default 2). */
  concurrency?: number;
  onResult?: (key: string, value: unknown) => void;
  onError?: (key: string, error: Error) => void;
  onProgress?: (progress: QueueProgress) => void;
}

type State = 'pending' | 'running' | 'done' | 'failed';

interface Entry {
  task: QueueTask;
  seq: number;
  state: State;
  ac?: AbortController;
}

/** A task's own error, or the reason it could not run. */
export const dependencyFailed = (): RpcError =>
  new RpcError('compare-dependency', 'A task this one needs failed');

export class CompareQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly concurrency: number;
  private readonly opts: QueueOptions;
  private focusSheet: number | null = null;
  private seq = 0;
  private running = 0;
  private cancelled = false;
  private idleWaiters: (() => void)[] = [];

  constructor(opts: QueueOptions = {}) {
    this.opts = opts;
    this.concurrency = Math.max(1, Math.floor(opts.concurrency ?? 2));
  }

  /** Adds tasks; they start as soon as a slot is free and their dependencies are done. */
  add(tasks: QueueTask[]): void {
    if (this.cancelled) throw new AbortError();
    for (const task of tasks) {
      if (this.entries.has(task.key)) throw new Error(`duplicate task ${task.key}`);
      this.entries.set(task.key, { task, seq: this.seq++, state: 'pending' });
    }
    this.failBlocked();
    this.emitProgress();
    this.pump();
  }

  /** The sheet the user is looking at: its tasks go first, then the sheets after it. */
  focus(sheet: number | null): void {
    this.focusSheet = sheet;
    this.pump();
  }

  get focused(): number | null {
    return this.focusSheet;
  }

  /** Cancels everything: running tasks are aborted, pending ones dropped. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const [key, e] of this.entries) {
      if (e.state === 'running') e.ac?.abort();
      if (e.state === 'pending') this.entries.delete(key);
    }
    this.emitProgress();
    this.checkIdle();
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  progress(): QueueProgress {
    let done = 0;
    let failed = 0;
    for (const e of this.entries.values()) {
      if (e.state === 'done') done++;
      else if (e.state === 'failed') failed++;
    }
    return { done, failed, total: this.entries.size, running: this.running };
  }

  state(key: string): State | undefined {
    return this.entries.get(key)?.state;
  }

  /** Pending tasks whose dependencies are done, in the order they would start. */
  readyOrder(): string[] {
    return this.ready().map((e) => e.task.key);
  }

  /** Resolves when nothing runs or waits (after cancel: when running tasks have stopped). */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private isIdle(): boolean {
    if (this.running > 0) return false;
    for (const e of this.entries.values()) if (e.state === 'pending') return false;
    return true;
  }

  private checkIdle(): void {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private depsDone(e: Entry): boolean {
    return (e.task.after ?? []).every((k) => this.entries.get(k)?.state === 'done');
  }

  /** Lower sorts first: the focused sheet, then the phase, then nearness after the focus. */
  private rank(e: Entry): [number, number, number, number] {
    const { sheet, phase } = e.task;
    const f = this.focusSheet;
    const focusedFirst = f !== null && sheet === f ? 0 : 1;
    let distance: number;
    if (sheet === null) distance = -1;
    else if (f === null) distance = sheet;
    else if (sheet >= f) distance = sheet - f;
    else distance = 1e9 + (f - sheet);
    return [focusedFirst, phase, distance, e.seq];
  }

  private ready(): Entry[] {
    const list: Entry[] = [];
    for (const e of this.entries.values())
      if (e.state === 'pending' && this.depsDone(e)) list.push(e);
    const ranks = new Map(list.map((e) => [e, this.rank(e)]));
    return list.sort((x, y) => {
      const a = ranks.get(x) ?? [0, 0, 0, 0];
      const b = ranks.get(y) ?? [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
      return 0;
    });
  }

  /** Pending tasks that wait on a failed (or unknown) task fail too. */
  private failBlocked(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of this.entries.values()) {
        if (e.state !== 'pending') continue;
        const blocked = (e.task.after ?? []).some((k) => {
          const d = this.entries.get(k);
          return !d || d.state === 'failed';
        });
        if (blocked) {
          e.state = 'failed';
          changed = true;
          this.opts.onError?.(e.task.key, dependencyFailed());
        }
      }
    }
  }

  private pump(): void {
    if (this.cancelled) return;
    while (this.running < this.concurrency) {
      const next = this.ready().find((e) => this.mayStart(e));
      if (!next) break;
      this.start(next);
    }
    this.checkIdle();
  }

  /** While the viewed sheet has work running, only its own tasks (or whole-comparison work) start. */
  private mayStart(e: Entry): boolean {
    const f = this.focusSheet;
    if (f === null || e.task.sheet === null || e.task.sheet === f) return true;
    for (const r of this.entries.values())
      if (r.state === 'running' && r.task.sheet === f) return false;
    return true;
  }

  private start(e: Entry): void {
    e.state = 'running';
    e.ac = new AbortController();
    this.running++;
    const signal = e.ac.signal;
    let p: Promise<unknown>;
    try {
      p = e.task.run(signal);
    } catch (err) {
      p = Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    p.then(
      (value) => {
        this.finish(e, () => {
          e.state = 'done';
          if (!signal.aborted) this.opts.onResult?.(e.task.key, value);
        });
      },
      (err: unknown) => {
        this.finish(e, () => {
          if (this.cancelled && isAbortError(err)) {
            this.entries.delete(e.task.key);
            return;
          }
          e.state = 'failed';
          this.opts.onError?.(e.task.key, err instanceof Error ? err : new Error(String(err)));
          this.failBlocked();
        });
      },
    );
  }

  private finish(e: Entry, settle: () => void): void {
    this.running--;
    delete e.ac;
    if (this.cancelled && e.state === 'running') {
      // Cancelled while running: no result is reported, and it no longer counts.
      this.entries.delete(e.task.key);
    } else settle();
    this.emitProgress();
    this.pump();
    this.checkIdle();
  }

  private emitProgress(): void {
    this.opts.onProgress?.(this.progress());
  }
}
