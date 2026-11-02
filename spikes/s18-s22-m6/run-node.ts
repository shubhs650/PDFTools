// M6-04 spikes S18 – S22 (ADR-021 Evidence). Runs the chosen spikes (default
// all) and writes spikes/s18-s22-m6/out/<spike>.json.
//
//   npm install --no-save @embedpdf/plugin-form@2.15.1 @embedpdf/plugin-signature@2.15.1
//   node --import ./spikes/shared/ts-ext.ts spikes/s18-s22-m6/run-node.ts [s18 s19 s20 s21 s22]
import { mkdirSync, writeFileSync } from 'node:fs';

const all = ['s18', 's19', 's20', 's21', 's22'];
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : all;
const files: Record<string, string> = {
  s18: './s18-encryption.ts',
  s19: './s19-forms.ts',
  s20: './s20-signatures.ts',
  s21: './s21-bookmarks.ts',
  s22: './s22-attach.ts',
};
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
for (const id of chosen) {
  const file = files[id];
  if (!file) throw new Error(`unknown spike ${id}`);
  const m = (await import(file)) as { run: () => Promise<Record<string, unknown>> };
  const t0 = performance.now();
  const result = await m.run();
  result.totalMs = Math.round(performance.now() - t0);
  writeFileSync(new URL(`./out/${id}.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(`== ${id}\n${JSON.stringify(result, null, 2)}`);
}
process.exit(0);
