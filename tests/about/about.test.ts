// File → About (M10-01, ADR-027 D-48): the service worker's navigation routes,
// the in-app license data, Built with and Copy version info.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  builtWith,
  collectNotices,
  FONT_LIBRARY_NOTICE,
  licenseData,
  renderNotices,
} from '../../scripts/notices.ts';
import { readFontManifest } from '../../scripts/fonts/manifest.ts';
import { BUILT_WITH, BUILT_WITH_PACKAGES } from '../../src/app/about/components';
import { filterPackages, NOTICES_URL } from '../../src/app/about/licenses';
import { versionInfoText } from '../../src/app/about/versionInfo';
import { versionParts } from '../../src/app/version';
import { t } from '../../src/i18n';
import { navigationPage } from '../../src/sw/routes';
import { splitPrecache } from '../../src/sw/precacheSplit';

const root = join(import.meta.dirname, '..', '..');

describe('service worker navigations (M10-01)', () => {
  const help = new Set(['/help.html', '/help']);

  it('app routes get the app', () => {
    for (const path of ['/', '/index.html', '/open', '/some/route', '/sub/'])
      expect(navigationPage(path, help), path).toBe('app');
  });

  it('/help gets Help', () => {
    expect(navigationPage('/help', help)).toBe('help');
    expect(navigationPage('/help.html', help)).toBe('help');
  });

  it('files are served as files: the third-party notices open as text, not the app', () => {
    for (const path of [`/${NOTICES_URL}`, '/fonts/latin/LICENSE.txt', '/icons/icon.svg', '/x.pdf'])
      expect(navigationPage(path, help), path).toBe('file');
  });

  it('the notices and the license chunk are in the background precache', () => {
    const { core, background } = splitPrecache(
      [NOTICES_URL, 'assets/licenseData-Ab12_c.js', 'assets/index-Cd34.js'].map((url) => ({
        url,
        revision: null,
      })),
    );
    expect(background.map((e) => e.url)).toEqual([NOTICES_URL, 'assets/licenseData-Ab12_c.js']);
    expect(core.map((e) => e.url)).toEqual(['assets/index-Cd34.js']);
  });
});

describe('Open-source licenses data (M10-01)', () => {
  const notices = collectNotices(root);
  const data = licenseData(notices);

  it('lists every package of the notices file, with every license text', () => {
    expect(data.packages.map((p) => `${p.name}@${p.version}`)).toEqual(
      notices.map((p) => `${p.name}@${p.version}`),
    );
    const text = renderNotices(notices);
    for (const p of data.packages) {
      expect(p.texts.length, p.name).toBeGreaterThan(0);
      for (const [source, i] of p.texts) {
        const body = data.texts[i];
        expect(body, `${p.name} ${source}`).toBeTruthy();
        expect(text).toContain(`${p.name} ${p.version}\nLicense: ${p.license}`);
      }
    }
  });

  it('stores each distinct text once', () => {
    expect(new Set(data.texts).size).toBe(data.texts.length);
    const all = new Set(
      notices.flatMap((p) => p.texts.map((x) => x.text.replace(/\r\n/g, '\n').trimEnd())),
    );
    expect(data.texts.length).toBe(all.size);
    // The point of sharing texts: far fewer texts than packages.
    expect(data.texts.length).toBeLessThan(data.packages.length);
  });

  it('includes PDFium, the fonts and the main components', () => {
    const names = new Set(data.packages.map((p) => p.name));
    for (const pkg of BUILT_WITH_PACKAGES) expect(names, pkg).toContain(pkg);
    const pdfium = data.packages.find((p) => p.name === '@embedpdf/pdfium');
    expect(pdfium?.texts.map(([s]) => s)).toContain('LICENSE.pdfium');
  });

  it('search matches every word against name, version and license', () => {
    expect(filterPackages(data.packages, '').length).toBe(data.packages.length);
    const reactDom = filterPackages(data.packages, '  REACT-dom ').map((p) => p.name);
    expect(reactDom).toContain('react-dom');
    expect(reactDom).not.toContain('react');
    const ofl = filterPackages(data.packages, 'fonts ofl');
    expect(ofl.length).toBeGreaterThan(0);
    for (const p of ofl) expect(p.license).toMatch(/OFL/);
    expect(filterPackages(data.packages, 'no-such-package-xyz')).toEqual([]);
  });
});

describe('Built with (M10-01)', () => {
  it('names only runtime packages, with their installed version and license', () => {
    const map = builtWith(collectNotices(root), BUILT_WITH_PACKAGES);
    for (const c of BUILT_WITH) {
      // The comment font library (M11-07) is vendored, not an npm package: its snapshot date.
      const pkg =
        c.pkg === FONT_LIBRARY_NOTICE
          ? { version: readFontManifest().snapshot }
          : (JSON.parse(
              readFileSync(join(root, 'node_modules', c.pkg, 'package.json'), 'utf8'),
            ) as { version: string });
      expect(map[c.pkg]?.version, c.pkg).toBe(pkg.version);
      expect(t(c.name)).not.toBe(c.name);
      expect(t(c.role)).not.toBe(c.role);
    }
    expect(() => builtWith(collectNotices(root), ['vitest'])).toThrow(/not a runtime package/);
  });
});

describe('Copy version info (M10-01, rule 10)', () => {
  it('splits the version and its commit', () => {
    expect(versionParts('0.10.0-beta+ab2edeb')).toEqual({
      version: '0.10.0-beta',
      commit: 'ab2edeb',
    });
    expect(versionParts('dev')).toEqual({ version: 'dev', commit: undefined });
  });

  it('has the version, build, browser, OS and offline state only', () => {
    const text = versionInfoText(t, {
      full: '0.10.0-beta+ab2edeb',
      built: 'Nov 16, 2026',
      offline: 'Ready to work offline on this device',
      nav: {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      },
    });
    expect(text).toBe(
      [
        'Triya PDF 0.10.0-beta',
        'Commit: ab2edeb',
        'Built: Nov 16, 2026',
        'Browser: Chrome 151',
        'OS: Windows',
        'Offline: Ready to work offline on this device',
      ].join('\n'),
    );
  });
});
