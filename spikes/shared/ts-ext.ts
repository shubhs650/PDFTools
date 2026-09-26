// Lets Node run spike scripts that import app modules from /src, which use
// extensionless relative imports (bundler resolution):
//   node --import ./spikes/shared/ts-ext.ts spikes/<spike>/run-node.ts
import { register } from 'node:module';

register('./ts-ext-hooks.ts', import.meta.url);
