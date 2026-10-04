// Worker entry for a Git-connected Cloudflare Worker (wrangler.jsonc). Pages
// routes `functions/api/report.ts` by its path; a Worker needs this module to
// do the same: `/api/report` runs the report handler, everything else is a
// static asset from `dist/` (the ASSETS binding applies `_headers` and the SPA
// fallback). The handler and its bindings are unchanged (D-22, §10.2).
import { onRequest, type Env } from './api/report';

/** The static-assets binding (wrangler.jsonc → assets.binding). */
interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv extends Env {
  ASSETS: Assets;
}

const REPORT_PATH = '/api/report';

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (new URL(request.url).pathname === REPORT_PATH) return onRequest({ request, env });
    return env.ASSETS.fetch(request);
  },
};
