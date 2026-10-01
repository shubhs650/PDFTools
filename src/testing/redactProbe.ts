// E2E-only probe for redaction (M4-18): the failure path (a step left out)
// and the verified output's bytes. Never shipped.
import { lastRedacted, setRedactTestSkip } from '../features/redact/applyFlow';
import type { SkipStep } from '../workers/work/redact/apply';
import type { TestHook } from './hook';

export function registerRedactProbe(hook: TestHook): void {
  hook.capabilities['redact'] = {
    skip: (step: SkipStep | null) => {
      setRedactTestSkip(step ?? undefined);
    },
    /** The last verified output, base64. */
    lastOutput: () => {
      if (!lastRedacted) return null;
      let bin = '';
      for (const b of new Uint8Array(lastRedacted)) bin += String.fromCharCode(b);
      return btoa(bin);
    },
  };
}
