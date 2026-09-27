// Printing through the browser's PDF viewer (M2-16, ADR-013 decision 7): the
// print-ready copy (vector) as a `blob:` of type application/pdf in a hidden
// frame, printed with the viewer's own dialog. This is the ONLY place that
// frames a blob: URL, the one use §10.1's `frame-src blob:` allows
// (tests/print/frame-src.test.ts keeps it that way).

const FRAME_CLASS = 'print-viewer-frame';
/** A viewer that never loads the file (disabled, blocked) fails the job instead of hanging it. */
const LOAD_TIMEOUT_MS = 15_000;

let current: { frame: HTMLIFrameElement; url: string } | null = null;

/** Removes the last viewer frame and frees its file. */
export function disposeViewerFrame(): void {
  if (!current) return;
  current.frame.remove();
  URL.revokeObjectURL(current.url);
  current = null;
}

/** Loads `pdf` into a hidden viewer frame; resolves on its `load`. */
export async function openViewerFrame(
  pdf: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<HTMLIFrameElement> {
  disposeViewerFrame();
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  const frame = document.createElement('iframe');
  frame.className = FRAME_CLASS;
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  current = { frame, url };
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener(
      'load',
      () => {
        resolve();
      },
      { once: true },
    );
  });
  frame.src = url;
  document.body.append(frame);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('viewer frame did not load'));
    }, LOAD_TIMEOUT_MS);
  });
  try {
    await Promise.race([loaded, timeout]);
  } catch (err) {
    disposeViewerFrame();
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (signal.aborted) {
    disposeViewerFrame();
    throw new DOMException('cancelled', 'AbortError');
  }
  return frame;
}

/**
 * Opens the viewer's print dialog (the one main-thread wait rule 1 allows,
 * ADR-001 B4). The frame stays until the next print, as the viewer prints
 * asynchronously and reports no end.
 */
export function printViewerFrame(frame: HTMLIFrameElement): void {
  const win = frame.contentWindow;
  if (!win) return;
  win.focus();
  win.print();
}
