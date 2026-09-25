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
  return hook;
}
