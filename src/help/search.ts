// Search in Help (M9, ADR-026): runs when the user presses Enter or the
// button (rule 3), over a few dozen short topics, so it is plain string work.
import { blockStrings, plain, type HelpText, type Vars } from './content';
import { TOPICS, type TopicId } from './topics';

export interface SearchHit {
  topic: TopicId;
  title: string;
  /** Text around the first match in the body (or the summary). */
  snippet: string;
}

const norm = (s: string): string => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Words of the query; every one must appear in a topic for it to match. */
export function queryWords(query: string): string[] {
  return norm(query)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function snippetAround(text: string, word: string, radius = 70): string {
  const at = norm(text).indexOf(word);
  if (at < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + word.length + radius);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

/** Topics whose text has every word of the query; title matches first, then reading order. */
export function searchHelp(text: HelpText, query: string, vars: Vars): SearchHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const hits: (SearchHit & { rank: number; order: number })[] = [];
  TOPICS.forEach((id, order) => {
    const topic = text.topics[id];
    const title = plain(topic.title, vars);
    const summary = plain(topic.summary, vars);
    const body = topic.body.flatMap(blockStrings).map((s) => plain(s, vars));
    const all = norm([title, summary, ...body].join('\n'));
    if (!words.every((w) => all.includes(w))) return;
    const inTitle = words.filter((w) => norm(title).includes(w)).length;
    const first = words[0] ?? '';
    const where = body.find((s) => norm(s).includes(first)) ?? summary;
    hits.push({ topic: id, title, snippet: snippetAround(where, first), rank: inTitle, order });
  });
  return hits
    .sort((a, b) => b.rank - a.rank || a.order - b.order)
    .map(({ topic, title, snippet }) => ({ topic, title, snippet }));
}
