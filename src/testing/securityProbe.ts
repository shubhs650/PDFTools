// E2E-only probe for Password Security (M6-12): the verified output's bytes.
// Never shipped.
import { lastSecured } from '../features/protect/passwordSecurity';
import type { TestHook } from './hook';

export function registerSecurityProbe(hook: TestHook): void {
  hook.capabilities['security'] = {
    /** The last verified output, base64. */
    lastOutput: () => {
      if (!lastSecured) return null;
      let bin = '';
      for (const b of new Uint8Array(lastSecured)) bin += String.fromCharCode(b);
      return btoa(bin);
    },
  };
}
