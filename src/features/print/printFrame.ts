// The print document (M2-15, ADR-013 finding 6): page images in a hidden
// same-origin about:blank iframe, printed with its own print(). No CSP
// change (blob: images are allowed). Images are awaited with `load`, never
// decode() (which rejects for large images in a hidden frame).
import { printedSize, type ScaleMode } from './options';
import type { PrintedPage } from './printJob';

const FRAME_CLASS = 'print-frame';

let current: { frame: HTMLIFrameElement; urls: string[] } | null = null;

/** Removes the last print document and frees its images. */
export function disposePrintFrame(): void {
  if (!current) return;
  current.frame.remove();
  for (const u of current.urls) URL.revokeObjectURL(u);
  current = null;
}

const CSS = `
@page { margin: 0; }
@page portrait { size: portrait; }
@page landscape { size: landscape; }
html, body { margin: 0; padding: 0; background: #fff; }
.page { page: portrait; display: flex; align-items: center; justify-content: center;
  width: 100vw; height: 100vh; overflow: hidden; break-after: page; }
.page.landscape { page: landscape; }
.page:last-child { break-after: auto; }
.sheet { display: flex; flex-direction: column; flex: none; }
.sheet img { display: block; width: 100%; height: auto; }
`;

/**
 * Builds the print document for `pages` and resolves once every image has
 * loaded. Fit: each page as large as the paper allows; actual / custom: its
 * size in points (× percent). Orientation follows each page (named pages).
 */
export async function buildPrintFrame(
  pages: readonly PrintedPage[],
  scale: ScaleMode,
  percent: number,
  signal: AbortSignal,
): Promise<HTMLIFrameElement> {
  disposePrintFrame();
  const frame = document.createElement('iframe');
  frame.className = FRAME_CLASS;
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  document.body.append(frame);
  const urls: string[] = [];
  current = { frame, urls };
  const doc = frame.contentDocument;
  if (!doc) throw new Error('no print document');
  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);
  const images: HTMLImageElement[] = [];
  for (const p of pages) {
    const page = doc.createElement('div');
    page.className = p.landscape ? 'page landscape' : 'page';
    const sheet = doc.createElement('div');
    sheet.className = 'sheet';
    const size = printedSize(p, scale, percent);
    if (size) {
      sheet.style.width = `${String(size.width)}pt`;
    } else {
      // As large as the paper allows, keeping the aspect ratio.
      const ratio = p.width / p.height;
      sheet.style.width = `min(100vw, calc(100vh * ${String(ratio)}))`;
    }
    for (const b of p.bands) {
      const img = doc.createElement('img');
      const url = URL.createObjectURL(b);
      urls.push(url);
      img.alt = '';
      img.src = url;
      sheet.append(img);
      images.push(img);
    }
    page.append(sheet);
    doc.body.append(page);
  }
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) resolve();
          img.addEventListener('load', () => {
            resolve();
          });
          img.addEventListener('error', () => {
            reject(new Error('print image'));
          });
        }),
    ),
  );
  if (signal.aborted) {
    disposePrintFrame();
    throw new DOMException('cancelled', 'AbortError');
  }
  return frame;
}

/**
 * Opens the browser's print dialog for the frame (the one main-thread wait
 * rule 1 allows, ADR-001 B4). The frame is kept until printing ends.
 */
export function printFrame(frame: HTMLIFrameElement): void {
  const win = frame.contentWindow;
  if (!win) return;
  win.addEventListener('afterprint', disposePrintFrame, { once: true });
  win.focus();
  win.print();
}
