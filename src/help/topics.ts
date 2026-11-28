// Help's table of contents (M9, ADR-026 D-46): chapters and their topics, in
// reading order. The text of every chapter and topic is in
// src/i18n/help.en.json (rule 11); topic ids are stable, because they are the
// Help window's addresses (/help#topic) and the app's "?" buttons use them.

/**
 * The Compare build switch (M12 plan question 3), read as src/app/commands.ts
 * reads it (PREVIEWS_ON) without importing the command table into Help's page:
 * a build with `VITE_COMPARE=off` leaves the Compare chapter out (M12-22).
 */
const COMPARE_ON: boolean =
  (import.meta as { env?: Record<string, string | undefined> }).env?.['VITE_COMPARE'] !== 'off';

/** The chapters behind the Compare build switch. */
const PREVIEW_CHAPTERS: readonly string[] = ['compare'];

/** Every chapter, whether this build shows it or not (the text has them all). */
export const ALL_CHAPTERS = [
  { id: 'start', topics: ['welcome', 'opening-files', 'offline'] },
  {
    id: 'view',
    topics: [
      'home-tab',
      'zoom-and-pages',
      'thin-lines',
      'view-history',
      'themes',
      'side-panes',
      'finding-text',
    ],
  },
  { id: 'bookmarks', topics: ['bookmarks'] },
  {
    id: 'comments',
    topics: [
      'comment-tab',
      'text-markup',
      'text-comments',
      'comment-fonts',
      'sticky-notes',
      'shapes',
      'stamps',
      'selecting-comments',
      'comment-properties',
      'comment-styles',
      'reviewing-comments',
      'crs-templates',
      'flatten-snapshot',
      'comment-transfer',
      'pasting-pictures',
      'attaching-files',
    ],
  },
  // M14-11: a topic for each part of the measuring overhaul (ADR-035, D-73 … D-78).
  {
    id: 'measure',
    topics: [
      'measure-scale',
      'scale-viewports',
      'measure-tools',
      'measure-volume',
      'measure-curves',
      'measure-count',
      'measure-editing',
      'measurements-pane',
      'measure-export',
      'measure-other-viewers',
      'snapping',
      'loupe',
    ],
  },
  { id: 'forms', topics: ['filling-forms', 'creating-fields', 'field-order'] },
  { id: 'pages', topics: ['organize-pages'] },
  { id: 'convert', topics: ['export-documents', 'extract-tables', 'ocr'] },
  // Compare (M12-22, D-58 … D-65): the PDF overlay and the text comparison.
  {
    id: 'compare',
    topics: [
      'compare-start',
      'compare-samples',
      'compare-overlay',
      'compare-alignment',
      'compare-differences',
      'compare-review',
      'compare-text',
      'compare-saving',
      'compare-other-readers',
    ],
  },
  { id: 'protect', topics: ['redaction', 'passwords', 'signing', 'protected-files'] },
  { id: 'save', topics: ['saving', 'printing', 'recovery'] },
  { id: 'reference', topics: ['keyboard-shortcuts', 'privacy', 'reporting-problems'] },
] as const;

export type ChapterId = (typeof ALL_CHAPTERS)[number]['id'];
export type TopicId = (typeof ALL_CHAPTERS)[number]['topics'][number];

type Chapter = (typeof ALL_CHAPTERS)[number];

/** The chapters of this build, in reading order: Compare only while it is switched on. */
export function chaptersFor(compareOn: boolean): readonly Chapter[] {
  return compareOn ? ALL_CHAPTERS : ALL_CHAPTERS.filter((c) => !PREVIEW_CHAPTERS.includes(c.id));
}

/** The chapters this build shows. */
export const CHAPTERS: readonly Chapter[] = chaptersFor(COMPARE_ON);

/** Every topic this build shows, in reading order. */
export const TOPICS: readonly TopicId[] = CHAPTERS.flatMap((c): readonly TopicId[] => c.topics);

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
  compare: 'compare-start',
  protect: 'redaction',
  help: 'welcome',
};

export function topicForTab(tab: string): TopicId {
  const topic = TAB_TOPIC[tab];
  return topic && isTopicId(topic) ? topic : FIRST_TOPIC;
}
