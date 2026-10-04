import { describe, expect, it } from 'vitest';
import { splitPrecache } from '../../src/sw/precacheSplit';

const e = (url: string) => ({ url, revision: null });

describe('precache split (§9, ADR-003 decision 3)', () => {
  const entries = [
    'index.html',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'assets/index-Ab12.js',
    'assets/index-Cd34.css',
    'assets/render.worker-Ef56.js',
    'assets/storage.worker-Gh78.js',
    'assets/encoder.worker-Ij90.js',
    'assets/work.worker-Kl12.js',
    'assets/snap.worker-Op56.js',
    'assets/exceljs.min-Qr78.js',
    'assets/pdf_oxide-St90.js',
    'assets/pdf_oxide_bg-Uv12.wasm',
    'assets/docxBuild-Wx34.js',
    'assets/ocr.worker-Yz56.js',
    'assets/tesseract-core-simd-lstm-Ab78.wasm',
    'ocr/eng.traineddata.gz',
    'ocr/hin.traineddata.gz',
    'ocr/chi_sim.traineddata.gz',
    'assets/pdfium-Mn34.wasm',
    'fonts/latin/NotoSans-Regular.ttf',
    'fonts/arabic/NotoNaskhArabic-Regular.ttf',
    'fonts/hebrew/NotoSansHebrew-Regular.ttf',
    'fonts/sc/NotoSansHans-Regular.otf',
    'fonts/tc/NotoSansHant-Regular.otf',
    'fonts/jp/NotoSansJP-Regular.otf',
    'fonts/kr/NotoSansKR-Regular.otf',
    'fonts/latin/LICENSE',
    'sw.js',
    'workbox-2fbc6a65.js',
  ].map(e);
  const { core, background, onDemand } = splitPrecache(entries);
  const urls = (l: { url: string }[]) => l.map((x) => x.url);

  it('core: shell, UI, Render/storage/encoder workers, PDFium WASM, Latin/Arabic/Hebrew fonts', () => {
    expect(urls(core)).toEqual([
      'index.html',
      'manifest.webmanifest',
      'icons/icon-192.png',
      'assets/index-Ab12.js',
      'assets/index-Cd34.css',
      'assets/render.worker-Ef56.js',
      'assets/storage.worker-Gh78.js',
      'assets/encoder.worker-Ij90.js',
      'assets/pdfium-Mn34.wasm',
      'fonts/latin/NotoSans-Regular.ttf',
      'fonts/arabic/NotoNaskhArabic-Regular.ttf',
      'fonts/hebrew/NotoSansHebrew-Regular.ttf',
    ]);
  });

  it('background: the Work and Snap workers, ExcelJS, PDF Oxide, the Word builder, OCR and the CJK fonts', () => {
    expect(urls(background)).toEqual([
      'assets/work.worker-Kl12.js',
      'assets/snap.worker-Op56.js',
      'assets/exceljs.min-Qr78.js',
      'assets/pdf_oxide-St90.js',
      'assets/pdf_oxide_bg-Uv12.wasm',
      'assets/docxBuild-Wx34.js',
      'assets/ocr.worker-Yz56.js',
      'assets/tesseract-core-simd-lstm-Ab78.wasm',
      'ocr/eng.traineddata.gz',
      'fonts/sc/NotoSansHans-Regular.otf',
      'fonts/tc/NotoSansHant-Regular.otf',
      'fonts/jp/NotoSansJP-Regular.otf',
      'fonts/kr/NotoSansKR-Regular.otf',
    ]);
  });

  it('on demand (never installed, cached when first fetched): the other OCR languages', () => {
    expect(urls(onDemand)).toEqual(['ocr/hin.traineddata.gz', 'ocr/chi_sim.traineddata.gz']);
  });

  it('never the service worker itself or license texts', () => {
    const all = urls([...core, ...background]);
    expect(all).not.toContain('sw.js');
    expect(all.some((u) => u.includes('workbox-') || u.endsWith('LICENSE'))).toBe(false);
  });
});
