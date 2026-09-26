// M2-02 spike page: can we print under the §10.1 CSP (served verbatim, with
// COOP/COEP)? Route 1: raster pages as blob: images in a same-origin
// about:blank iframe (no CSP change). Route 2: a PDF in a blob: iframe for the
// browser's own PDF viewer (needs `frame-src blob:`, ADR-001 B13).
import { installProbes, probe, type CspViolation } from '../shared/probe.ts';

installProbes();

const minimalPdf = (): Uint8Array<ArrayBuffer> => {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
  ];
  let s = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(s.length);
    s += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const x = s.length;
  s += `xref\n0 4\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${String(x)}\n%%EOF\n`;
  return new TextEncoder().encode(s);
};

function frameViolations(frame: HTMLIFrameElement): CspViolation[] {
  const list: CspViolation[] = [];
  frame.contentDocument?.addEventListener('securitypolicyviolation', (e) => {
    list.push({
      directive: e.effectiveDirective,
      blockedURI: e.blockedURI,
      sourceFile: e.sourceFile,
    });
  });
  return list;
}

const api = {
  probe,
  async makePages(n: number, w: number, h: number): Promise<string[]> {
    const worker = new Worker(new URL('./page.worker.ts', import.meta.url), { type: 'module' });
    const blobs = await new Promise<Blob[]>((resolve) => {
      worker.onmessage = (e: MessageEvent<Blob[]>) => {
        resolve(e.data);
      };
      worker.postMessage({ n, w, h });
    });
    worker.terminate();
    return blobs.map((b) => URL.createObjectURL(b));
  },
  /** Route 1: images in an about:blank iframe, then print() on it. */
  async rasterPrint(urls: string[], callPrint: boolean) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    document.body.append(frame);
    const doc = frame.contentDocument;
    if (!doc) throw new Error('no iframe document');
    const violations = frameViolations(frame);
    const style = doc.createElement('style');
    style.textContent =
      '@page{margin:0} body{margin:0} img{display:block;width:100%;break-after:page}';
    doc.head.append(style);
    const t0 = performance.now();
    const imgs = urls.map((u) => {
      const img = doc.createElement('img');
      img.src = u;
      img.alt = '';
      doc.body.append(img);
      return img;
    });
    // decode() rejects for large images in a hidden iframe (EncodingError in
    // Chromium); waiting for load is what printing needs anyway.
    await Promise.all(
      imgs.map(
        (i) =>
          new Promise((resolve) => {
            if (i.complete) resolve(null);
            i.onload = resolve;
            i.onerror = resolve;
          }),
      ),
    );
    const decodedMs = performance.now() - t0;
    let printMs = -1;
    if (callPrint) {
      const t1 = performance.now();
      frame.contentWindow?.print();
      printMs = performance.now() - t1;
    }
    const loaded = imgs.filter((i) => i.naturalWidth > 0).length;
    frame.remove();
    return { loaded, decodedMs, printMs, frameViolations: violations };
  },
  /** Route 2: a PDF in a blob: iframe (the browser's PDF viewer). */
  async blobPdfFrame() {
    const url = URL.createObjectURL(new Blob([minimalPdf()], { type: 'application/pdf' }));
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:400px;height:300px;border:0';
    const before = probe.cspViolations.length;
    const loaded = await new Promise<boolean>((resolve) => {
      frame.onload = () => {
        resolve(true);
      };
      setTimeout(() => {
        resolve(false);
      }, 3000);
      frame.src = url;
      document.body.append(frame);
    });
    await new Promise((r) => setTimeout(r, 300));
    const violations = probe.cspViolations.slice(before);
    frame.remove();
    return { loadEvent: loaded, violations };
  },
};

(window as unknown as { __s11: typeof api }).__s11 = api;
document.title = 'S11 ready';
