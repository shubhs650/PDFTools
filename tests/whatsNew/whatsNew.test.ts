// @vitest-environment jsdom
// What's new (M10-08·O6, ADR-027): the release list, when the banner shows
// (once after an update, never on a first visit), and its record on this device.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  announceAction,
  dismissWhatsNew,
  LATEST_RELEASE_ID,
  releaseDate,
  releases,
  requestWhatsNewInAbout,
  resetWhatsNew,
  startWhatsNew,
  WHATS_NEW_STORAGE_KEY,
  whatsNewStore,
} from '../../src/features/whatsNew/releases';
import { LOCAL_DATA } from '../../src/features/settings/storedData';
import { PSEUDO_LOCALE } from '../../src/i18n/pseudo';

const root = join(import.meta.dirname, '..', '..');

describe('release list', () => {
  const list = releases('en');

  it('is newest first, with unique ids, real dates and some notes each', () => {
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
    for (const r of list) {
      expect(r.date, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(releaseDate(r.date).getTime()), r.id).toBe(false);
      expect(r.title.trim(), r.id).not.toBe('');
      expect(r.items.length, r.id).toBeGreaterThan(0);
      for (const item of r.items) expect(item.trim(), r.id).not.toBe('');
    }
    const dates = list.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(LATEST_RELEASE_ID).toBe(list[0]?.id);
  });

  it('the newest release has its full notes in docs/release-notes', () => {
    const notes = readdirSync(join(root, 'docs', 'release-notes'));
    expect(notes).toContain(`${LATEST_RELEASE_ID}.md`);
  });

  it('1.0.0, the first public release, is the only entry (ADR-029)', () => {
    expect(list.map((r) => r.id)).toEqual(['v1.0.0']);
    const text = list[0]?.items.join(' ') ?? '';
    for (const words of ['tabs', 'Comment', 'Measure', 'forms', 'redact', 'OCR', 'offline'])
      expect(text, words).toContain(words);
  });

  it('reads a date as a local calendar date', () => {
    const d = releaseDate('2026-11-17');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 17]);
  });

  it('is pseudo-localized in the pseudo-locale, keeping ids and dates', () => {
    const pseudo = releases(PSEUDO_LOCALE);
    expect(pseudo.map((r) => [r.id, r.date])).toEqual(list.map((r) => [r.id, r.date]));
    expect(pseudo[0]?.title).not.toBe(list[0]?.title);
    expect(pseudo[0]?.items.length).toBe(list[0]?.items.length);
  });
});

describe('when the banner shows', () => {
  it('never twice for the same release', () => {
    expect(announceAction('beta-m10', 'beta-m10', true)).toBe('none');
    expect(announceAction('beta-m10', 'beta-m10', false)).toBe('none');
  });

  it('a first visit records the release without a banner', () => {
    expect(announceAction(null, 'beta-m10', false)).toBe('record');
  });

  it('after an update: an older record, or a returning device with none', () => {
    expect(announceAction('beta-m9', 'beta-m10', false)).toBe('banner');
    expect(announceAction('beta-m9', 'beta-m10', true)).toBe('banner');
    expect(announceAction(null, 'beta-m10', true)).toBe('banner');
  });
});

describe('start and the record on this device', () => {
  beforeEach(() => {
    localStorage.clear();
    whatsNewStore.setState({ banner: null, focusInAbout: false });
  });

  it('first visit: records quietly', () => {
    startWhatsNew(false);
    expect(whatsNewStore.getState().banner).toBeNull();
    expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(LATEST_RELEASE_ID);
  });

  it('after an update: shows once, then never on the next start', () => {
    localStorage.setItem(WHATS_NEW_STORAGE_KEY, 'beta-m9');
    startWhatsNew(true);
    expect(whatsNewStore.getState().banner).toBe(LATEST_RELEASE_ID);
    expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBe(LATEST_RELEASE_ID);
    dismissWhatsNew();
    expect(whatsNewStore.getState().banner).toBeNull();
    startWhatsNew(true);
    expect(whatsNewStore.getState().banner).toBeNull();
  });

  it('See what’s new closes the banner and asks About for its list', () => {
    whatsNewStore.setState({ banner: LATEST_RELEASE_ID });
    requestWhatsNewInAbout();
    expect(whatsNewStore.getState()).toEqual({ banner: null, focusInAbout: true });
  });

  it('is listed on the Privacy page and cleared by Clear all local data', () => {
    const item = LOCAL_DATA.find((d) => d.store === WHATS_NEW_STORAGE_KEY);
    expect(item).toMatchObject({ kind: 'localStorage', cleared: true });
    localStorage.setItem(WHATS_NEW_STORAGE_KEY, LATEST_RELEASE_ID);
    resetWhatsNew();
    expect(localStorage.getItem(WHATS_NEW_STORAGE_KEY)).toBeNull();
  });
});
