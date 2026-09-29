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
  const { core, background } = splitPrecache(entries);
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

  it('background: the Work and Snap workers and the CJK fonts', () => {
    expect(urls(background)).toEqual([
      'assets/work.worker-Kl12.js',
      'assets/snap.worker-Op56.js',
      'fonts/sc/NotoSansHans-Regular.otf',
      'fonts/tc/NotoSansHant-Regular.otf',
      'fonts/jp/NotoSansJP-Regular.otf',
      'fonts/kr/NotoSansKR-Regular.otf',
    ]);
  });

  it('never the service worker itself or license texts', () => {
    const all = urls([...core, ...background]);
    expect(all).not.toContain('sw.js');
    expect(all.some((u) => u.includes('workbox-') || u.endsWith('LICENSE'))).toBe(false);
  });
});
