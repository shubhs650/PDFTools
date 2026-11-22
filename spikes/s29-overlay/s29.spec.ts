// Spike S29 (M12-04, D-59) — the browser half: the overlay drawn at the
// current zoom, combined in the browser's compositor (CSS blend) against in a
// worker. Speed while zooming, memory, main-thread long tasks, exact black on
// overlap, style changes.
//   SPIKE=s29 PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run spikes -- --project=s29
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

const results: Record<string, unknown> = {};
const note = (k: string, v: unknown) => {
  results[k] = v;
  console.log(k, JSON.stringify(v));
};

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s29-browser.json', JSON.stringify(results, null, 2));
});

type Api = Record<string, (...a: unknown[]) => Promise<unknown>>;
const s29 = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, a]) => (window as unknown as { s29: Api }).s29[f]?.(...a), [
    fn,
    args,
  ] as const) as Promise<T>;

async function start(page: Page, pair: string) {
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { state: 'attached' });
  await s29(page, 'init');
  return s29<{ w: number; h: number }>(
    page,
    'open',
    `/corpus/${pair}-old.pdf`,
    `/corpus/${pair}-new.pdf`,
  );
}

/** RGB pixels of a PNG screenshot (8-bit RGB or RGBA, no interlace). */
function decodePng(buf: Buffer): { w: number; h: number; ch: number; px: Uint8Array } {
  let i = 8;
  let w = 0;
  let h = 0;
  let ch = 4;
  const idat: Buffer[] = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i);
    const t = buf.toString('latin1', i + 4, i + 8);
    if (t === 'IHDR') {
      w = buf.readUInt32BE(i + 8);
      h = buf.readUInt32BE(i + 12);
      ch = buf[i + 17] === 2 ? 3 : 4;
    } else if (t === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0, p = 0; y < h; y++) {
    const f = raw[p++] ?? 0;
    const line = new Uint8Array(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? (line[x - ch] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= ch ? (prev[x - ch] ?? 0) : 0;
      const v = line[x] ?? 0;
      if (f === 1) line[x] = (v + a) & 255;
      else if (f === 2) line[x] = (v + b) & 255;
      else if (f === 3) line[x] = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        line[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    px.set(line, y * stride);
    prev = line;
  }
  return { w, h, ch, px };
}

/** Colour classes of a screenshot: white, black, red-ish, green-ish, the rest. */
function classes(png: Buffer) {
  const { px, ch } = decodePng(png);
  const out = { white: 0, black: 0, red: 0, green: 0, other: 0 };
  for (let i = 0; i < px.length; i += ch) {
    const r = px[i] ?? 0;
    const g = px[i + 1] ?? 0;
    const b = px[i + 2] ?? 0;
    if (r > 247 && g > 247 && b > 247) out.white++;
    else if (r < 8 && g < 8 && b < 8) out.black++;
    else if (r > 200 && g < r - 60 && b < r - 60 && Math.abs(g - b) < 16) out.red++;
    else if (g > 200 && r < g - 60 && b < g - 60 && Math.abs(r - b) < 16) out.green++;
    else out.other++;
  }
  return out;
}

const ROUTES = ['worker', 'compositor'] as const;

test('exact black on overlap: the identical control pair shows no colour in either route', async ({
  page,
}) => {
  await start(page, 'p16');
  for (const route of ROUTES) {
    await s29(page, 'setRoute', route);
    await s29(page, 'setZoom', 1.5);
    await s29(page, 'scrollTo', 0.45, 0.45);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1580, height: 980 } });
    const c = classes(shot);
    note(`identicalControl.${route}`, c);
    expect(c.red + c.green).toBe(0);
    expect(c.black).toBeGreaterThan(100);
  }
});

test('pair 01: both routes show the same red, green and black; style changes', async ({ page }) => {
  await start(page, 'p01');
  const shots: Record<string, ReturnType<typeof classes>> = {};
  for (const route of ROUTES) {
    await s29(page, 'setRoute', route);
    await s29(page, 'setZoom', 1);
    await s29(page, 'scrollTo', 0.35, 0.45);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1580, height: 980 } });
    writeFileSync(`test-results/s29-pair01-${route}.png`, png);
    shots[route] = classes(png);
  }
  note('pair01.classes', shots);
  const w = shots.worker;
  const c = shots.compositor;
  expect(w && c).toBeTruthy();
  if (!w || !c) return;
  // The two routes agree to within a few per cent on every class.
  for (const k of ['red', 'green', 'black'] as const)
    expect(Math.abs(w[k] - c[k])).toBeLessThan(Math.max(200, w[k] * 0.05));

  // Style changes: colour preset, balance, Fade unchanged, Thicken.
  const times: Record<string, Record<string, number>> = {};
  for (const route of ROUTES) {
    await s29(page, 'setRoute', route);
    await s29(page, 'setZoom', 1);
    const t: Record<string, number> = {};
    t.preset = await s29<number>(page, 'setStyle', { colA: [255, 0, 0], colB: [0, 0, 255] });
    t.balance = await s29<number>(page, 'setStyle', { balance: 0.5 });
    t.hideOld = await s29<number>(page, 'setStyle', { balance: 0, showA: false });
    t.showOld = await s29<number>(page, 'setStyle', { showA: true, colB: [0, 255, 0] });
    if (route === 'worker') {
      t.fade = await s29<number>(page, 'setStyle', { fade: 1 });
      t.neutral = await s29<number>(page, 'setStyle', { fade: 0 }, 'neutral');
      t.thicken = await s29<number>(page, 'setStyle', {}, 'neutral', true);
      t.thinAgain = await s29<number>(page, 'setStyle', {}, 'multiply', false);
    }
    times[route] = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));
  }
  note('styleChangeMs', times);
});

for (const [pair, label] of [
  ['p14', 'dense A1 sheet (pair 14)'],
  ['p01', 'flange (pair 01)'],
] as const) {
  test(`zooming the overlay: ${label}, compositor against worker`, async ({ page }) => {
    await start(page, pair);
    const out: Record<string, unknown> = {};
    for (const route of ROUTES) {
      // Each route starts from closed documents (no grey tiles cached).
      await s29(page, 'open', `/corpus/${pair}-old.pdf`, `/corpus/${pair}-new.pdf`);
      await s29(page, 'setRoute', route);
      await s29(page, 'setZoom', 0.25);
      await s29(page, 'scrollTo', 0.5, 0.5);
      await s29(page, 'resetTimes');
      // Sharp after a jump in zoom (what the user waits for).
      const jumps: Record<string, number> = {};
      for (const z of [1, 4, 16, 64])
        jumps[`${String(z * 100)} %`] = Math.round(await s29<number>(page, 'setZoom', z));
      // A zoom gesture 100 % → 800 %: 12 steps, 80 ms apart, rendering as it goes.
      await s29(page, 'setZoom', 1);
      const gesture = await s29<Record<string, number>>(page, 'zoomGesture', 1, 8, 12, 80);
      const stats = await s29<Record<string, number>>(page, 'stats');
      const workerStats = await s29<Record<string, number>>(page, 'workerStats');
      const memMB = await s29<number | null>(page, 'memory');
      out[route] = { sharpAfterJumpMs: jumps, gesture, stats, workerStats, jsWasmHeapsMB: memMB };
      expect(gesture.longTasks).toBe(0);
    }
    note(`zoom.${pair}`, out);
  });
}
