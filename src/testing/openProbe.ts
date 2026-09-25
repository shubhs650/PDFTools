// E2E-only probe for the open pipeline (M1-13). Never part of a production build.
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { documentStore } from '../app/store/documentStore';
import { openFiles } from '../features/open/openDocument';
import { sources } from '../features/open/sources';
import { capability, hostStore } from '../features/view/host';
import type { TestHook } from './hook';

const decode = (b64: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function registerOpenProbe(hook: TestHook): void {
  hook.capabilities['open'] = {
    /** Writes files to OPFS and opens them through their handles (the FSA path). */
    async openHandles(files: { name: string; b64: string }[]) {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('e2e-files', { create: true });
      const opened = [];
      for (const f of files) {
        const handle = await dir.getFileHandle(f.name, { create: true });
        const w = await handle.createWritable();
        await w.write(decode(f.b64));
        await w.close();
        opened.push({ file: await handle.getFile(), handle });
      }
      return openFiles(opened);
    },
    state() {
      const s = documentStore.getState();
      const registry = hostStore.getState().registry;
      const dm = registry
        ? capability<DocumentManagerCapability>(registry, 'document-manager')
        : undefined;
      return {
        names: s.order.map((id) => s.docs[id]?.meta.name),
        active: s.activeId ? s.docs[s.activeId]?.meta.name : null,
        activeId: s.activeId,
        engineActive: dm?.getActiveDocumentId() ?? null,
        engineOrder: dm?.getDocumentOrder() ?? [],
        sources: sources.size,
        permissions: s.order.map((id) => s.docs[id]?.meta.permissions),
        pageCounts: s.order.map((id) => s.docs[id]?.meta.pageCount),
      };
    },
  };
}
