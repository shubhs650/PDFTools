// E2E-only probe for the Work worker and its memory policy (M1-08). Never part
// of a production build.
import { createRenderEngine } from '../engine/createEngine';
import { openDocument } from '../engine/renderClient';
import { SearchSession } from '../engine/searchSession';
import { WorkClient } from '../engine/workClient';
import { indexStatus } from '../features/search/indexing';
import { workClient } from '../features/view/host';
import type { SearchOptions } from '../workers/work/searchCore';
import type { TestHook } from './hook';

let client: WorkClient | undefined;

const decode = (b64: string): ArrayBuffer =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

export function registerWorkProbe(hook: TestHook): void {
  hook.capabilities['work'] = {
    /** Opens the same bytes in the Render worker and the Work worker (§3.1: each has its own copy). */
    async openBoth(b64: string, respawnAboveMB: number) {
      client?.terminate();
      client = new WorkClient({ respawnAboveBytes: respawnAboveMB * 1024 * 1024 });
      const render = createRenderEngine({ fontFallback: null });
      const { info } = await openDocument(render, { docId: 'doc', bytes: decode(b64) });
      // The Work worker receives its copy by transfer; reload() re-derives it after a respawn.
      const work = await client.open('doc', decode(b64), {
        reload: () => Promise.resolve(decode(b64)),
      });
      return { renderPages: info.pageCount, workPages: work.pageCount };
    },
    async textStats() {
      if (!client) throw new Error('no client');
      return client.run('textStats', { docId: 'doc' }).promise;
    },
    async docState() {
      if (!client) throw new Error('no client');
      return client.run('docState', { docId: 'doc' }).promise;
    },
    memory: () => client?.memory(),
    respawns: () => client?.respawns ?? 0,
    lastCheckedBytes: () => client?.lastCheckedBytes ?? 0,
  };

  // M2-05: search through the app's own Work client, on a document opened
  // the normal way. Timings are taken on the main thread (what a user sees).
  const session = new SearchSession(workClient());
  hook.capabilities['search'] = {
    /** Background indexing of a document (M2-06). */
    indexStatus: (docId: string) => indexStatus(docId) ?? null,
    async run(docId: string, query: string, options: SearchOptions = {}, visible: number[] = [0]) {
      const t0 = performance.now();
      let firstHitMs: number | null = null;
      let hits = 0;
      let counted = 0;
      let batches = 0;
      const { promise } = session.start({ docId, query, options, visible }, (b) => {
        batches++;
        hits += b.hits.length;
        counted += b.counts.reduce((n, [, c]) => n + c, 0);
        if (firstHitMs === null && (b.hits.length > 0 || b.counts.length > 0))
          firstHitMs = performance.now() - t0;
      });
      const summary = await promise;
      return { firstHitMs, totalMs: performance.now() - t0, hits, counted, batches, summary };
    },
    /** Starts `a`, then `b` after `afterMs`: how fast `a` stops, and whether any of its batches came after. */
    async supersede(docId: string, a: string, b: string, afterMs: number) {
      const seen: string[] = [];
      const first = session.start({ docId, query: a, options: {}, visible: [0] }, () => {
        seen.push('a');
      });
      const firstEnd = first.promise.then(
        () => 'finished',
        () => 'cancelled',
      );
      await new Promise((r) => setTimeout(r, afterMs));
      const t = performance.now();
      const second = session.start({ docId, query: b, options: {}, visible: [0] }, () => {
        seen.push('b');
      });
      const outcome = await firstEnd;
      const stopMs = performance.now() - t;
      await second.promise;
      const firstB = seen.indexOf('b');
      return {
        outcome,
        stopMs,
        staleAfterNew: firstB < 0 ? 0 : seen.slice(firstB).filter((x) => x === 'a').length,
      };
    },
  };
}
