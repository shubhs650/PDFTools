// @vitest-environment jsdom
// Top bar (M6-01, ADR-021 D-35): the issue link carries version, browser and OS
// only (rule 10); the brand mark is the app icon; the full-screen key.
import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../src/i18n';
import { KEYMAP } from '../../src/app/keys/keymap';
import { parseChord } from '../../src/app/keys/chord';
import {
  EXTERNAL_LINK,
  NEW_ISSUE_URL,
  OPENENGTOOLS_URL,
  currentIssueUrl,
  issueUrl,
} from '../../src/app/links';
import { AppMark, Brand, TopBarActions } from '../../src/app/TopBar';
import { documentStore } from '../../src/app/store/documentStore';
import { UiProvider } from '../../src/ui/components';

afterEach(cleanup);

const CHROME = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  userAgentData: { brands: [{ brand: 'Google Chrome', version: '151' }], platform: 'Windows' },
};

const params = (url: string) => new URL(url).searchParams;

describe('issue URL builder (rule 10)', () => {
  it('opens the repository new-issue page with title and body', () => {
    const url = issueUrl(
      { app: '0.9.0+abc1234', nav: CHROME },
      { title: 'Problem: ', body: (e) => `App: ${e.app}\nBrowser: ${e.browser}\nOS: ${e.os}` },
    );
    expect(url.startsWith(`${NEW_ISSUE_URL}?`)).toBe(true);
    expect(params(url).get('title')).toBe('Problem: ');
    expect(params(url).get('body')).toBe('App: 0.9.0+abc1234\nBrowser: Chrome 151\nOS: Windows');
  });

  it('holds only the app version, browser and OS families — never the full user agent', () => {
    const body = params(
      issueUrl({ app: 'dev', nav: CHROME }, { title: '', body: (e) => JSON.stringify(e) }),
    ).get('body');
    expect(JSON.parse(body ?? '')).toEqual({ app: 'dev', browser: 'Chrome 151', os: 'Windows' });
    expect(body).not.toContain('Mozilla');
  });

  it('contains nothing from the document store with a document open', () => {
    act(() => {
      documentStore.getState().open({
        id: 'doc-7f3a',
        name: 'Q3-budget-ZEBRA.pdf',
        pageCount: 12,
        permissions: -1,
        signatureCount: 0,
      });
    });
    try {
      const url = decodeURIComponent(currentIssueUrl(t));
      expect(url).not.toMatch(/budget|ZEBRA|doc-7f3a|\.pdf/i);
      const body = params(currentIssueUrl(t)).get('body') ?? '';
      expect(body).toContain('App: dev');
      expect(body).toMatch(/Browser: /);
      expect(body).toMatch(/OS: /);
    } finally {
      act(() => {
        documentStore.getState().close('doc-7f3a');
      });
    }
  });
});

describe('top bar', () => {
  it('shows the product name as the page heading next to the mark', () => {
    render(<Brand />);
    expect(screen.getByRole('heading', { level: 1, name: 'PDFTools' })).toBeTruthy();
  });

  it('draws the app icon from public/icons/icon.svg (no request, same artwork)', () => {
    const file = readFileSync('public/icons/icon.svg', 'utf8');
    const attrs = (svg: string, name: string) =>
      [...svg.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1]);
    const inline = renderToStaticMarkup(<AppMark />);
    for (const a of ['d', 'fill', 'stroke', 'stroke-width', 'viewBox', 'rx'])
      expect(attrs(inline, a), a).toEqual(attrs(file, a));
    expect(inline).toContain('aria-hidden="true"');
  });

  it('opens both links in a new tab without opener or referrer, with accessible names', () => {
    render(
      <UiProvider>
        <TopBarActions />
      </UiProvider>,
    );
    const home = screen.getByRole('link', { name: 'OpenEngTools Home' });
    expect(home.getAttribute('href')).toBe(OPENENGTOOLS_URL);
    const issue = screen.getByRole('link', { name: 'Report an Issue on GitHub' });
    expect(issue.getAttribute('href')?.startsWith(`${NEW_ISSUE_URL}?`)).toBe(true);
    for (const a of [home, issue]) {
      expect(a.getAttribute('target')).toBe(EXTERNAL_LINK.target);
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(screen.getByRole('button', { name: 'Full Screen' })).toBeTruthy();
  });
});

describe('full-screen key (M6-01)', () => {
  it('is Ctrl+Shift+F11, global (F11 stays the browser’s)', () => {
    const bnd = KEYMAP.find((b) => b.target === 'view.fullScreen');
    expect(bnd?.scope).toBe('global');
    expect(bnd?.chords).toEqual([parseChord('Ctrl+Shift+F11')]);
    expect(KEYMAP.some((b) => b.chords.some((c) => c.key === 'F11' && !c.ctrl))).toBe(false);
  });
});
