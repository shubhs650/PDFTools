// The comment font list (M11-07, D-52): one list wherever a text comment's
// font is chosen (Properties pane, tool defaults, Comment Styles, the text
// menu's Text Style). Recently used on top, then the standard fonts, then the
// library's groups. Type-ahead jumps to a name: a short local list, not a
// document search (rule 3). Pure.
import { msg, type MessageKey } from '../../../i18n/keys';
import {
  FONT_GROUPS,
  libraryFamily,
  PICKER_FAMILIES,
  type FontGroup,
} from '../../../model/fonts/library';
import { FONT_FAMILIES, isCommentFont, type FontFamily } from '../properties/model';

export type SectionId = 'recent' | 'standard' | FontGroup;

export interface FontOption {
  id: string;
  /** A proper name (library) or an i18n key (standard families). */
  name: { text: string } | { key: MessageKey };
  /** A few characters of its script, after the name. */
  sample?: string;
}

export interface FontSection {
  id: SectionId;
  title: MessageKey;
  options: FontOption[];
}

export const STANDARD_NAME_KEYS: Record<FontFamily, MessageKey> = {
  helvetica: msg('annotProps.font.helvetica'),
  times: msg('annotProps.font.times'),
  courier: msg('annotProps.font.courier'),
};

export const SECTION_TITLES: Record<SectionId, MessageKey> = {
  recent: msg('fonts.group.recent'),
  standard: msg('fonts.group.standard'),
  office: msg('fonts.group.office'),
  sans: msg('fonts.group.sans'),
  narrow: msg('fonts.group.narrow'),
  technical: msg('fonts.group.technical'),
  serif: msg('fonts.group.serif'),
  mono: msg('fonts.group.mono'),
  hand: msg('fonts.group.hand'),
  hindi: msg('fonts.group.hindi'),
  chinese: msg('fonts.group.chinese'),
};

/** One option for a font id (standard or library), or null. */
export function fontOption(id: string): FontOption | null {
  if ((FONT_FAMILIES as readonly string[]).includes(id))
    return { id, name: { key: STANDARD_NAME_KEYS[id as FontFamily] } };
  const lib = libraryFamily(id);
  if (!lib?.group) return null;
  return { id, name: { text: lib.name }, ...(lib.sample ? { sample: lib.sample } : {}) };
}

/** The list's sections: Recently used (if any), Standard, then the library's groups. */
export function fontSections(recent: readonly string[]): FontSection[] {
  const out: FontSection[] = [];
  const rec = recent
    .filter(isCommentFont)
    .map(fontOption)
    .filter((o): o is FontOption => !!o);
  if (rec.length) out.push({ id: 'recent', title: SECTION_TITLES.recent, options: rec });
  out.push({
    id: 'standard',
    title: SECTION_TITLES.standard,
    options: FONT_FAMILIES.map((f) => fontOption(f)).filter((o): o is FontOption => !!o),
  });
  for (const g of FONT_GROUPS) {
    const options = PICKER_FAMILIES.filter((f) => f.group === g)
      .map((f) => fontOption(f.id))
      .filter((o): o is FontOption => !!o);
    if (options.length) out.push({ id: g, title: SECTION_TITLES[g], options });
  }
  return out;
}

/**
 * Type-ahead: the first option after `from` (wrapping) whose name starts with
 * `query` (case and accents ignored); -1 if none. `names` in list order.
 */
export function typeahead(names: readonly string[], query: string, from: number): number {
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  let q = fold(query);
  if (!q) return -1;
  // Typing one more letter refines the current match; a repeated letter
  // ("rrr") cycles through the names starting with it, as in a menu.
  const repeated = q.length > 1 && Array.from(q).every((c) => c === q[0]);
  if (repeated) q = q.slice(0, 1);
  const start = q.length > 1 ? from : from + 1;
  const n = names.length;
  for (let i = 0; i < n; i++) {
    const k = (((start + i) % n) + n) % n;
    if (fold(names[k] ?? '').startsWith(q)) return k;
  }
  return -1;
}
