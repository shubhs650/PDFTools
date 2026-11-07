// Help's text (M9, ADR-026 D-46): src/i18n/help.en.json (rule 11), read as a
// tree. A topic is a title, a one-line summary and a body of blocks. Inline
// markup in any string: <b>UI name</b>, <kbd>{{save}}</kbd>, [text](#topic-id),
// and {{name}} for the product name and this platform's keys.
import helpEn from '../i18n/help.en.json';
import { APP_NAME } from '../i18n/appName';
import { PSEUDO_LOCALE, pseudoResources } from '../i18n/pseudo';
import type { TopicId, ChapterId } from './topics';

export type Block =
  | { p: string }
  | { h: string }
  | { steps: string[] }
  | { list: string[] }
  | { tip: string }
  | { shot: string; alt: string; caption?: string }
  | { table: 'shortcuts' };

export interface Topic {
  title: string;
  summary: string;
  body: Block[];
}

export interface HelpText {
  ui: typeof helpEn.ui;
  chapters: Record<ChapterId, string>;
  topics: Record<TopicId, Topic>;
}

let pseudo: HelpText | undefined;

/** Help's strings in the UI language (the pseudo-locale in dev and e2e builds). */
export function helpText(language: string): HelpText {
  const en = helpEn as unknown as HelpText;
  if (language !== PSEUDO_LOCALE) return en;
  pseudo ??= pseudoResources(en);
  return pseudo;
}

export type Vars = Readonly<Record<string, string>>;

/** Fills {{name}} placeholders ({{app}} is the product name); unknown ones stay as they are. */
export function fill(text: string, vars: Vars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) =>
    k === 'app' ? APP_NAME : (vars[k] ?? m),
  );
}

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'ui'; text: string }
  | { kind: 'key'; text: string }
  | { kind: 'link'; text: string; topic: string };

const TOKEN = /(<b>[\s\S]*?<\/b>|<kbd>[\s\S]*?<\/kbd>|\[[^\]]+\]\(#[\w-]+\))/;

/** Splits a string into text, UI names, keys and topic links (pure). */
export function parseInline(text: string, vars: Vars): Inline[] {
  const out: Inline[] = [];
  text.split(TOKEN).forEach((part, i) => {
    if (part === '') return;
    if (i % 2 === 0) {
      out.push({ kind: 'text', text: fill(part, vars) });
    } else if (part.startsWith('<b>')) {
      out.push({ kind: 'ui', text: fill(part.slice(3, -4), vars) });
    } else if (part.startsWith('<kbd>')) {
      out.push({ kind: 'key', text: fill(part.slice(5, -6), vars) });
    } else {
      const m = /^\[([^\]]+)\]\(#([\w-]+)\)$/.exec(part);
      if (m?.[1] && m[2]) out.push({ kind: 'link', text: fill(m[1], vars), topic: m[2] });
    }
  });
  return out;
}

/** The plain text of a string, as read (for search and snippets). */
export function plain(text: string, vars: Vars): string {
  return parseInline(text, vars)
    .map((x) => x.text)
    .join('');
}

/** Every string of a block, in order. */
export function blockStrings(b: Block): string[] {
  if ('p' in b) return [b.p];
  if ('h' in b) return [b.h];
  if ('steps' in b) return b.steps;
  if ('list' in b) return b.list;
  if ('tip' in b) return [b.tip];
  if ('shot' in b) return b.caption ? [b.caption] : [];
  return [];
}

/** Where a screenshot is served (public/help-img, made by `npm run help:screenshots`). */
export const shotUrl = (id: string): string => `/help-img/${id}.webp`;

/** The screenshots a topic shows, in order. */
export function topicShots(t: Topic): string[] {
  return t.body.flatMap((b) => ('shot' in b ? [b.shot] : []));
}
