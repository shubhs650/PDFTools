// Test-only hook (M1-Q3). Compiled in only by `vite build --mode e2e`; main.tsx
// imports this module behind an `import.meta.env.MODE === 'e2e'` check, which
// production builds remove. scripts/check-dist.ts fails if the marker below
// ever reaches a production bundle.
//
// Later tasks register capabilities here (e.g. M1-20 adds annotations through
// the engine so save and recovery can be tested before M3's annotation UI).

export const TEST_HOOK_GLOBAL = '__pdftoolsTest';

export interface TestHook {
  version: 1;
  /** Capabilities registered by feature code, keyed by name. */
  capabilities: Record<string, unknown>;
}

export function installTestHook(): TestHook {
  const hook: TestHook = { version: 1, capabilities: {} };
  (window as unknown as Record<string, unknown>)[TEST_HOOK_GLOBAL] = hook;
  void import('./engineProbe').then((m) => {
    m.registerEngineProbe(hook);
  });
  void import('./workProbe').then((m) => {
    m.registerWorkProbe(hook);
  });
  void import('./viewProbe').then((m) => {
    m.registerViewProbe(hook);
  });
  void import('./openProbe').then((m) => {
    m.registerOpenProbe(hook);
  });
  void import('./storageProbe').then((m) => {
    m.registerStorageProbe(hook);
  });
  void import('./saveProbe').then((m) => {
    m.registerSaveProbe(hook);
  });
  void import('./annotateProbe').then((m) => {
    m.registerAnnotateProbe(hook);
  });
  void import('./extractProbe').then((m) => {
    m.registerExtractProbe(hook);
  });
  void import('./pagesProbe').then((m) => {
    m.registerPagesProbe(hook);
  });
  void import('./redactProbe').then((m) => {
    m.registerRedactProbe(hook);
  });
  void import('../app/commands/dispatch').then((d) => {
    const calls: string[] = [];
    hook.capabilities['commands'] = {
      /** Replaces the handlers of `ids` with recorders (e2e only). */
      spy: (ids: string[]) => {
        for (const id of ids) {
          d.registerCommand(id, {
            run: () => {
              calls.push(id);
            },
          });
        }
      },
      calls: () => [...calls],
      /** Runs a command as the ribbon would (e2e: reach dialogs in any locale). */
      run: (id: string) => d.runCommand(id),
    };
  });
  void Promise.all([
    import('../app/store/appStore'),
    import('../app/store/documentStore'),
    import('../features/search/findStore'),
  ]).then(([app, docs, find]) => {
    hook.capabilities['stores'] = { app: app.appStore, documents: docs.documentStore };
    hook.capabilities['find'] = {
      /** What the find bar has run (null: nothing yet) and its status (M2-07). */
      state: () => {
        const s = find.findStore.getState();
        return { ran: s.ran, status: s.status, total: s.results.total, cursor: s.cursor };
      },
    };
  });
  return hook;
}
