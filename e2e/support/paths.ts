import { fileURLToPath } from 'node:url';

/** Output of `vite build --mode e2e` (includes the test hook; never deployed). */
export const E2E_DIST = fileURLToPath(new URL('../../dist-e2e', import.meta.url));
