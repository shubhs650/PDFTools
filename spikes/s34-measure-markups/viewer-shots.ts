// Spike S34 (M14-01): pictures of the interop pack in Chromium's own PDF viewer
// (the Chrome/Edge viewer), for the owner's hand check.
//   node --import ./spikes/shared/ts-ext.ts spikes/s34-measure-markups/viewer-shots.ts <out dir>
// Chromium only re-renders on a new tab, so each picture opens its own tab.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const PACK_PATH = fileURLToPath(
  new URL('../../Synthetic PDF Corpus/measure/interop/S34_interop_pack.pdf', import.meta.url),
);
const out = process.argv[2];
if (!out) throw new Error('usage: viewer-shots.ts <out dir>');
mkdirSync(out, { recursive: true });

/** Whole pages, then zoomed views (percent, x, y in points from the top left). */
const shots: { name: string; page: number; view: string }[] = [
  { name: 'viewer-p1-floor-plan', page: 1, view: 'view=Fit' },
  { name: 'viewer-p2-pipe-run', page: 2, view: 'view=Fit' },
  { name: 'viewer-p3-three-scales', page: 3, view: 'view=Fit' },
  { name: 'viewer-p1-zoom-area-volume', page: 1, view: 'zoom=200,110,360' },
  { name: 'viewer-p1-zoom-lengths', page: 1, view: 'zoom=200,110,90' },
  { name: 'viewer-p2-zoom-angles-radius', page: 2, view: 'zoom=200,380,300' },
  { name: 'viewer-p2-zoom-counts', page: 2, view: 'zoom=250,160,420' },
  { name: 'viewer-p3-zoom-cutout', page: 3, view: 'zoom=250,150,520' },
  { name: 'viewer-p3-zoom-alternatives', page: 3, view: 'zoom=200,690,90' },
];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
});
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 950 },
  deviceScaleFactor: 2,
});
const url = pathToFileURL(PACK_PATH).href;
for (const s of shots) {
  const tab = await ctx.newPage();
  await tab.goto(`${url}#page=${String(s.page)}&toolbar=0&${s.view}`);
  await tab.waitForTimeout(2500);
  await tab.screenshot({ path: join(out, `${s.name}.png`) });
  await tab.close();
  console.log(s.name);
}
await browser.close();
