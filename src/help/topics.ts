// Help's table of contents (M9, ADR-026 D-46): chapters and their topics, in
// reading order. The text of every chapter and topic is in
// src/i18n/help.en.json (rule 11); topic ids are stable, because they are the
// Help window's addresses (/help#topic) and the app's "?" buttons use them.

export const CHAPTERS = [
  { id: 'start', topics: ['welcome', 'opening-files', 'offline'] },
  {
    id: 'view',
    topics: ['home-tab', 'zoom-and-pages', 'themes', 'side-panes', 'finding-text'],
  },
  { id: 'bookmarks', topics: ['bookmarks'] },
  {
    id: 'comments',
    topics: [
      'comment-tab',
      'text-markup',
      'text-comments',
      'sticky-notes',
      'shapes',
      'stamps',
      'selecting-comments',
      'comment-properties',
      'comment-styles',
      'reviewing-comments',
      'flatten-snapshot',
      'comment-transfer',
      'pasting-pictures',
      'attaching-files',
    ],
  },
  { id: 'measure', topics: ['measure-scale', 'measure-tools', 'snapping'] },
  { id: 'forms', topics: ['filling-forms', 'creating-fields', 'field-order'] },
  { id: 'pages', topics: ['organize-pages'] },
  { id: 'convert', topics: ['export-documents', 'extract-tables', 'ocr'] },
  { id: 'protect', topics: ['redaction', 'passwords', 'signing', 'protected-files'] },
  { id: 'save', topics: ['saving', 'printing', 'recovery'] },
  { id: 'reference', topics: ['keyboard-shortcuts', 'privacy', 'reporting-problems'] },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]['id'];
export type TopicId = (typeof CHAPTERS)[number]['topics'][number];

/** Every topic, in reading order. */
export const TOPICS: readonly TopicId[] = CHAPTERS.flatMap((c) => c.topics);

/** The first topic: the Help window's start page. */
export const FIRST_TOPIC: TopicId = 'welcome';

export function isTopicId(id: string): id is TopicId {
  return (TOPICS as readonly string[]).includes(id);
}

export function chapterOf(topic: TopicId): ChapterId {
  const c = CHAPTERS.find((ch) => (ch.topics as readonly string[]).includes(topic));
  return c?.id ?? 'start';
}

/** F1 with no dialog open: the topic for the active ribbon tab. */
const TAB_TOPIC: Record<string, TopicId> = {
  file: 'saving',
  home: 'home-tab',
  view: 'zoom-and-pages',
  comment: 'comment-tab',
  form: 'creating-fields',
  measure: 'measure-tools',
  organize: 'organize-pages',
  convert: 'export-documents',
  protect: 'redaction',
  help: 'welcome',
};

export function topicForTab(tab: string): TopicId {
  return TAB_TOPIC[tab] ?? FIRST_TOPIC;
}
