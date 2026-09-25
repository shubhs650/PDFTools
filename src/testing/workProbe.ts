// E2E-only probe for the Work worker and its memory policy (M1-08). Never part
// of a production build.
import { createRenderEngine } from '../engine/createEngine';
import { openDocument } from '../engine/renderClient';
import { WorkClient } from '../engine/workClient';
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
}
