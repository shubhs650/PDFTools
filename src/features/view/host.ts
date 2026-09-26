// The app's engines (ARCHITECTURE §3.1): one Render worker (EmbedPDF's
// PdfEngine over our hosted PDFium), one Work worker, one plugin registry.
// Created on first use (the first open), so a cold start with no document
// spends nothing on PDFium.
import type { PluginRegistry } from '@embedpdf/core';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { createRenderEngine, type RenderEngine } from '../../engine/createEngine';
import { localFontConfig } from '../../engine/fonts';
import { WorkClient } from '../../engine/workClient';
import { instrumentEngine } from './renderStats';
import { TileCache } from './tileCache';
import { installRanker } from './tileScheduler';

interface HostState {
  render: RenderEngine | null;
  registry: PluginRegistry | null;
}

export const hostStore = createStore<HostState>()(() => ({ render: null, registry: null }));

export function useHost<T>(selector: (s: HostState) => T): T {
  return useStore(hostStore, selector);
}

let work: WorkClient | undefined;

/** Rendered previews and tiles of every open document (§5). */
export const tileCache = new TileCache();

export function renderEngine(): RenderEngine {
  const existing = hostStore.getState().render;
  if (existing) return existing;
  const render = createRenderEngine({
    fontFallback: localFontConfig(location.origin),
    onMutation: (_method, docId) => {
      documentStore.getState().markDirty(docId);
    },
  });
  instrumentEngine(render.engine, tileCache);
  installRanker(render.engine);
  hostStore.setState({ render });
  return render;
}

export function workClient(): WorkClient {
  work ??= new WorkClient();
  return work;
}

/** The Work worker client if it was ever started; closing never starts one. */
export function startedWorkClient(): WorkClient | undefined {
  return work;
}

/** Called by DocumentHost once EmbedPDF has initialized the plugins. */
export function setRegistry(registry: PluginRegistry | null): void {
  hostStore.setState({ registry });
}

/** Starts the engine if needed and resolves once the plugin registry is up. */
export function whenRegistry(): Promise<PluginRegistry> {
  renderEngine();
  const now = hostStore.getState().registry;
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const off = hostStore.subscribe((s) => {
      if (!s.registry) return;
      off();
      resolve(s.registry);
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed plugin lookup
export function capability<T>(registry: PluginRegistry, id: string): T {
  const plugin = registry.getPlugin(id);
  if (!plugin?.provides) throw new Error(`Plugin ${id} is not ready`);
  return plugin.provides() as T;
}

/** The document manager, once PDFium is initialized in the Render worker. */
export async function documentManager(): Promise<DocumentManagerCapability> {
  const registry = await whenRegistry();
  await renderEngine().ready;
  return capability<DocumentManagerCapability>(registry, 'document-manager');
}
