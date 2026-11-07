// Help's screenshot harness (M9, ADR-026): crops a part of the real app,
// draws numbered callouts and outlines on top, encodes WebP inside Chromium
// (canvas.toBlob, no image library: sharp bundles LGPL libvips, rule 5) and
// writes public/help-img/<id>.webp plus its size in src/help/shots.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export const IMG_DIR = join('public', 'help-img');
export const SHOTS_JSON = join('src', 'help', 'shots.json');

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Target = Locator | Box;

type Anchor = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'c';

export interface Callout {
  n: number;
  target: Target;
  /** Where on the target the number goes (default: top-left corner). */
  at?: Anchor;
  /** Also outline the target. */
  outline?: boolean;
  /** Moves the number from its anchor (CSS px). */
  dx?: number;
  dy?: number;
}

export interface ShootOptions {
  /** What to capture: the union of these, plus `pad`. Default: the whole window. */
  clip?: Target | Target[];
  pad?: number;
  callouts?: Callout[];
  /** Outlines without a number. */
  outline?: Target[];
}

async function boxOf(t: Target): Promise<Box> {
  if ('x' in t && 'width' in t) return t;
  const b = await t.boundingBox();
  if (!b) throw new Error(`not visible: ${String(t)}`);
  return b;
}

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const btm = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

function anchorPoint(b: Box, at: Anchor): { x: number; y: number } {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  switch (at) {
    case 'tl':
      return { x: b.x, y: b.y };
    case 'tr':
      return { x: b.x + b.width, y: b.y };
    case 'bl':
      return { x: b.x, y: b.y + b.height };
    case 'br':
      return { x: b.x + b.width, y: b.y + b.height };
    case 't':
      return { x: cx, y: b.y };
    case 'b':
      return { x: cx, y: b.y + b.height };
    case 'l':
      return { x: b.x, y: cy };
    case 'r':
      return { x: b.x + b.width, y: cy };
    default:
      return { x: cx, y: cy };
  }
}

/** Callout colour: an orange that stands out from the app's blue in both themes. */
const MARK = '#ca5010';

export async function shoot(page: Page, id: string, opts: ShootOptions = {}): Promise<void> {
  const vp = page.viewportSize() ?? { width: 1366, height: 800 };
  const pad = opts.pad ?? 8;
  const targets = opts.clip === undefined ? [] : Array.isArray(opts.clip) ? opts.clip : [opts.clip];
  let clip: Box = targets.length
    ? union(await Promise.all(targets.map(boxOf)))
    : { x: 0, y: 0, width: vp.width, height: vp.height };
  if (targets.length) {
    const x = Math.max(0, Math.floor(clip.x - pad));
    const y = Math.max(0, Math.floor(clip.y - pad));
    clip = {
      x,
      y,
      width: Math.min(vp.width, Math.ceil(clip.x + clip.width + pad)) - x,
      height: Math.min(vp.height, Math.ceil(clip.y + clip.height + pad)) - y,
    };
  }

  const marks: { kind: 'n' | 'o'; n?: number; x: number; y: number; w?: number; h?: number }[] =
    [];
  for (const c of opts.callouts ?? []) {
    const b = await boxOf(c.target);
    const p = anchorPoint(b, c.at ?? 'tl');
    marks.push({ kind: 'n', n: c.n, x: p.x + (c.dx ?? 0), y: p.y + (c.dy ?? 0) });
    if (c.outline) marks.push({ kind: 'o', x: b.x, y: b.y, w: b.width, h: b.height });
  }
  for (const t of opts.outline ?? []) {
    const b = await boxOf(t);
    marks.push({ kind: 'o', x: b.x, y: b.y, w: b.width, h: b.height });
  }
  // Keep every number inside the picture.
  for (const m of marks) {
    if (m.kind !== 'n') continue;
    m.x = Math.min(Math.max(m.x, clip.x + 13), clip.x + clip.width - 13);
    m.y = Math.min(Math.max(m.y, clip.y + 13), clip.y + clip.height - 13);
  }

  await page.evaluate(
    ({ marks, color }) => {
      const layer = document.createElement('div');
      layer.id = '__help-shot-marks';
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      for (const m of marks) {
        const el = document.createElement('div');
        if (m.kind === 'o') {
          el.style.cssText = `position:fixed;left:${String(m.x - 3)}px;top:${String(m.y - 3)}px;width:${String((m.w ?? 0) + 6)}px;height:${String((m.h ?? 0) + 6)}px;border:2.5px solid ${color};border-radius:6px;box-sizing:border-box`;
        } else {
          el.textContent = String(m.n);
          el.style.cssText = `position:fixed;left:${String(m.x - 12)}px;top:${String(m.y - 12)}px;width:24px;height:24px;border-radius:50%;background:${color};color:#fff;font:600 13px/24px 'Segoe UI',system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.35)`;
        }
        layer.append(el);
      }
      document.body.append(layer);
    },
    { marks, color: MARK },
  );
  // Let the overlay paint; the app's own caret and hover states stay as they are.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = await page.screenshot({ clip, type: 'png', animations: 'disabled', caret: 'hide' });
  await page.evaluate(() => document.getElementById('__help-shot-marks')?.remove());

  const webp = await page.evaluate(async (b64) => {
    // An <img> (the CSP allows data: images; fetch() of a data: URL it doesn't).
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const bmp = await createImageBitmap(img);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((r) => {
      canvas.toBlob(r, 'image/webp', 0.82);
    });
    if (!blob || blob.type !== 'image/webp') throw new Error('no WebP encoder');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, png.toString('base64'));

  mkdirSync(IMG_DIR, { recursive: true });
  writeFileSync(join(IMG_DIR, `${id}.webp`), Buffer.from(webp, 'base64'));
  const sizes = JSON.parse(readFileSync(SHOTS_JSON, 'utf8')) as Record<
    string,
    { w: number; h: number }
  >;
  sizes[id] = { w: Math.round(clip.width), h: Math.round(clip.height) };
  const sorted = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(SHOTS_JSON, `${JSON.stringify(sorted, null, 2)}\n`);
}
