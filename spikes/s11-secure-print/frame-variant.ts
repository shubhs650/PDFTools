// Adds `frame-src blob:` to the CSP of the S11 build in dist-frame (the only
// change ADR-013 proposes); the Playwright web server builds it first.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'spikes/s11-secure-print/dist-frame/_headers';
const headers = readFileSync(file, 'utf8');
if (!headers.includes("object-src 'none'")) throw new Error('unexpected _headers');
writeFileSync(file, headers.replace("object-src 'none';", "frame-src blob:; object-src 'none';"));
