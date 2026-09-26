// Rasterizes the app icon SVGs (our own artwork, rule 15) into the PNG sizes
// the web app manifest needs, with the bundled Chromium. Run after editing
// scripts/icons/*.svg: `node scripts/gen-app-icons.ts`. Outputs are committed.
import { copyFileSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = 'public/icons';
const jobs = [
  { src: 'scripts/icons/app-icon.svg', size: 192, out: 'icon-192.png', transparent: true },
  { src: 'scripts/icons/app-icon.svg', size: 512, out: 'icon-512.png', transparent: true },
  {
    src: 'scripts/icons/app-icon-maskable.svg',
    size: 512,
    out: 'icon-maskable-512.png',
    transparent: false,
  },
];

const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  const svg = readFileSync(j.src, 'utf8');
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${String(j.size)}" height="${String(j.size)}" `)}</body></html>`,
  );
  await page.screenshot({ path: `${OUT}/${j.out}`, omitBackground: j.transparent });
  console.log(`${OUT}/${j.out}`);
}
await browser.close();
copyFileSync('scripts/icons/app-icon.svg', `${OUT}/icon.svg`);
