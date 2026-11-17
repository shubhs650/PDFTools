/**
 * Keeps the Render worker's calls in the order they arrive across a wait that
 * is not PDFium's (M11-07, D-52: a text comment's library font loading before
 * PDFium draws it). The RPC host starts every call as its message arrives, so
 * without this a save or an edit sent after such a comment could run before
 * it. With no such wait outstanding, a call starts at once, as before; while
 * one is, later calls queue behind it, in arrival order.
 */
export class CallOrder {
  private gate: Promise<void> | null = null;

  /** Runs `f` in order; `blocks`: later calls wait for this one (it may load fonts). */
  run<T>(f: () => T | Promise<T>, blocks: boolean): Promise<T> {
    const prev = this.gate;
    const result = prev ? prev.then(f) : (async () => f())();
    if (prev || blocks) {
      const g = result.then(
        () => undefined,
        () => undefined,
      );
      this.gate = g;
      void g.then(() => {
        if (this.gate === g) this.gate = null;
      });
    }
    return result;
  }
}
