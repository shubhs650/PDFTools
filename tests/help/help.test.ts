// Help (M9, ADR-026 D-46): the text, its screenshots, search and topic links.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RIBBON_TABS } from '../../src/app/commands';
import {
  blockStrings,
  fill,
  helpText,
  parseInline,
  plain,
  topicShots,
} from '../../src/help/content';
import { helpKeys } from '../../src/help/keys';
import { searchHelp, queryWords } from '../../src/help/search';
import shots from '../../src/help/shots.json';
import {
  CHAPTERS,
  FIRST_TOPIC,
  TOPICS,
  chapterOf,
  isTopicId,
  topicForTab,
} from '../../src/help/topics';
import helpEn from '../../src/i18n/help.en.json';
import { APP_NAME } from '../../src/i18n/appName';
import { t } from '../../src/i18n';
import { PSEUDO_LOCALE } from '../../src/i18n/pseudo';
import { isHelpFile, splitPrecache } from '../../src/sw/precacheSplit';

const en = helpText('en');
const vars = helpKeys(t);
const sizes = shots as Record<string, { w: number; h: number }>;
const IMG_DIR = join('public', 'help-img');

/** Every string in a topic: title, summary and body. */
const topicStrings = (id: (typeof TOPICS)[number]): string[] => {
  const topic = en.topics[id];
  return [topic.title, topic.summary, ...topic.body.flatMap(blockStrings)];
};

describe('Help topics and text', () => {
  it('has every topic of every chapter, and nothing else', () => {
    expect(Object.keys(helpEn.topics).sort()).toEqual([...TOPICS].sort());
    expect(Object.keys(helpEn.chapters).sort()).toEqual(CHAPTERS.map((c) => c.id).sort());
    expect(new Set(TOPICS).size).toBe(TOPICS.length);
    expect(TOPICS[0]).toBe(FIRST_TOPIC);
    for (const id of TOPICS) {
      const topic = en.topics[id];
      expect(topic.title, id).not.toBe('');
      expect(topic.summary, id).not.toBe('');
      expect(topic.body.length, id).toBeGreaterThan(0);
      expect(CHAPTERS.find((c) => c.id === chapterOf(id))?.topics).toContain(id);
    }
  });

  it('links only to topics that exist', () => {
    for (const id of TOPICS) {
      for (const s of topicStrings(id)) {
        for (const part of parseInline(s, vars)) {
          if (part.kind === 'link')
            expect(isTopicId(part.topic), `${id}: ${part.topic}`).toBe(true);
        }
      }
    }
  });

  it('names only keys it knows, and closes its markup', () => {
    for (const id of TOPICS) {
      for (const s of topicStrings(id)) {
        const filled = fill(s, vars);
        expect(filled, `${id}: ${s}`).not.toMatch(/\{\{\w+\}\}/);
        expect(plain(s, vars), `${id}: ${s}`).not.toMatch(/<\/?(b|kbd)>|\]\(#/);
      }
    }
    // Every key Help names is bound in the keymap.
    for (const [name, label] of Object.entries(vars)) expect(label, name).not.toBe('');
  });

  it('parses UI names, keys and links', () => {
    expect(
      parseInline('Choose <b>Save</b> or press <kbd>{{save}}</kbd>; see [Saving](#saving).', vars),
    ).toEqual([
      { kind: 'text', text: 'Choose ' },
      { kind: 'ui', text: 'Save' },
      { kind: 'text', text: ' or press ' },
      { kind: 'key', text: 'Ctrl+S' },
      { kind: 'text', text: '; see ' },
      { kind: 'link', text: 'Saving', topic: 'saving' },
      { kind: 'text', text: '.' },
    ]);
    expect(fill('{{app}} works offline', {})).toBe(`${APP_NAME} works offline`);
    expect(fill('{{unknown}}', {})).toBe('{{unknown}}');
  });

  it('opens at the chapter of the active ribbon tab', () => {
    for (const tab of RIBBON_TABS) expect(isTopicId(topicForTab(tab)), tab).toBe(true);
    expect(topicForTab('measure')).toBe('measure-tools');
    expect(topicForTab('nonsense')).toBe(FIRST_TOPIC);
  });
});

describe('Help screenshots', () => {
  const used = TOPICS.flatMap((id) => topicShots(en.topics[id]));

  it('every screenshot has its file, its size and alt text', () => {
    expect(new Set(used).size).toBe(used.length);
    for (const id of TOPICS) {
      for (const b of en.topics[id].body) {
        if (!('shot' in b)) continue;
        expect(b.alt, b.shot).not.toBe('');
        expect(existsSync(join(IMG_DIR, `${b.shot}.webp`)), b.shot).toBe(true);
        expect(sizes[b.shot]?.w, b.shot).toBeGreaterThan(0);
        expect(sizes[b.shot]?.h, b.shot).toBeGreaterThan(0);
      }
    }
  });

  it('has no unused pictures', () => {
    const files = readdirSync(IMG_DIR).map((f) => f.replace(/\.webp$/, ''));
    expect(files.sort()).toEqual([...used].sort());
    expect(Object.keys(sizes).sort()).toEqual([...used].sort());
  });

  it('are WebP files of a sensible size', () => {
    for (const id of used) {
      const bytes = readFileSync(join(IMG_DIR, `${id}.webp`));
      expect(bytes.subarray(0, 4).toString('latin1'), id).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('latin1'), id).toBe('WEBP');
      expect(bytes.length, id).toBeLessThan(250_000);
    }
  });
});

describe('Help search (rule 3: runs on Enter only, in HelpApp)', () => {
  it('splits the query into words, ignoring case and accents', () => {
    expect(queryWords('  Redaction   MARKS ')).toEqual(['redaction', 'marks']);
    expect(queryWords('Café')).toEqual(['cafe']);
    expect(queryWords('   ')).toEqual([]);
  });

  it('finds topics with every word, title matches first', () => {
    const hits = searchHelp(en, 'redact', vars);
    expect(hits[0]?.topic).toBe('redaction');
    expect(hits.length).toBeGreaterThan(1);
    const both = searchHelp(en, 'owner password', vars);
    expect(both.length).toBeGreaterThan(0);
    for (const h of both) {
      const text = topicStrings(h.topic)
        .map((s) => plain(s, vars).toLowerCase())
        .join(' ');
      expect(text).toContain('owner');
      expect(text).toContain('password');
    }
    expect(searchHelp(en, 'zzqqxx', vars)).toEqual([]);
    expect(searchHelp(en, '', vars)).toEqual([]);
  });

  it('shows a snippet around the match', () => {
    const [hit] = searchHelp(en, 'Ready offline', vars);
    expect(hit?.topic).toBe('offline');
    expect(hit?.snippet.toLowerCase()).toContain('ready offline');
  });
});

describe('Help in the pseudo-locale', () => {
  const xa = helpText(PSEUDO_LOCALE);

  it('keeps steps as lists, screenshot ids and topic links', () => {
    const steps = xa.topics.saving.body.find((b) => 'list' in b);
    expect(Array.isArray(steps && 'list' in steps ? steps.list : null)).toBe(true);
    const shot = xa.topics.saving.body.find((b) => 'shot' in b);
    expect(shot && 'shot' in shot ? shot.shot : '').toBe('saving-1');
    const link = xa.topics['measure-tools'].body
      .flatMap(blockStrings)
      .flatMap((s) => parseInline(s, vars))
      .flatMap((p) => (p.kind === 'link' ? [p.topic] : []))[0];
    expect(link).toBe('measure-scale');
    expect(xa.topics.saving.title).not.toBe(en.topics.saving.title);
  });
});

describe('Help offline (precache)', () => {
  it('caches the Help page, its code and its pictures in the background group', () => {
    for (const url of [
      'help.html',
      'assets/help-Ab12.js',
      'assets/help-Cd34.css',
      'help-img/saving-1.webp',
    ])
      expect(isHelpFile(url), url).toBe(true);
    for (const url of ['index.html', 'assets/index-Ab12.js', 'help-img/x.png'])
      expect(isHelpFile(url), url).toBe(false);
    const { core, background } = splitPrecache(
      ['index.html', 'help.html', 'assets/help-Ab12.js', 'help-img/saving-1.webp'].map((url) => ({
        url,
        revision: null,
      })),
    );
    expect(core.map((e) => e.url)).toEqual(['index.html']);
    expect(background.map((e) => e.url).sort()).toEqual(
      ['assets/help-Ab12.js', 'help-img/saving-1.webp', 'help.html'].sort(),
    );
  });
});
