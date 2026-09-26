// One search at a time per consumer (D-08, §6, ADR-006): starting a search
// cancels the previous one, and batches of any older search are dropped even
// if they were already on their way. Quick Find (M2-07) and Advanced Search
// (M2-09) each hold a session.
import type { CallOptions } from './rpc';
import type { SearchBatch, SearchRequest, SearchSummary } from '../workers/work/search';

export interface SearchRunner {
  run(
    method: 'search',
    args: SearchRequest,
    options: CallOptions<SearchBatch>,
  ): { promise: Promise<SearchSummary>; cancel(): void };
}

export class SearchSession {
  private seq = 0;
  private current: { cancel(): void } | null = null;
  private readonly runner: SearchRunner;

  constructor(runner: SearchRunner) {
    this.runner = runner;
  }

  /** Id of the search whose batches are delivered (0 before the first). */
  get activeId(): number {
    return this.seq;
  }

  start(
    req: Omit<SearchRequest, 'searchId'>,
    onBatch: (batch: SearchBatch) => void,
  ): { searchId: number; promise: Promise<SearchSummary> } {
    this.current?.cancel();
    const searchId = ++this.seq;
    const job = this.runner.run(
      'search',
      { ...req, searchId },
      {
        onProgress: (batch) => {
          if (batch.searchId === this.seq) onBatch(batch);
        },
      },
    );
    this.current = job;
    return { searchId, promise: job.promise };
  }

  cancel(): void {
    this.current?.cancel();
    this.current = null;
    this.seq++;
  }
}
