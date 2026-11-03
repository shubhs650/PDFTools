// The comment style palette (M6-07, ADR-021 D-37, beta review B5): preset
// styles per tool (Red, Purple, Indigo, Blue, Green, Yellow, Black, and the
// Cloudy variants for closed shapes), the user's own styles, which comments a
// picked style restyles, the `.pdftools-styles.json` export/import format and
// the swatch grid's keyboard moves. A style is a plain property set (the
// plugin's annotation fields, toolDefaults.ts) applied through the existing
// annotation-property path, so appearances stay PDFium's (§7.1).
// Pure: no store, no plugin.
import { PdfAnnotationBorderStyle } from '@embedpdf/models';
import {
  cleanProps,
  STYLE_TOOLS,
  isStyleTool,
  type StyleProps,
  type StyleTool,
} from './toolDefaults';

/** Ribbon commands that are split buttons with a palette → their tool. */
export const PALETTE_COMMANDS: Readonly<Record<string, StyleTool>> = {
  'comment.textBox': 'freeText',
  'comment.callout': 'freeTextCallout',
  'comment.line': 'line',
  'comment.arrow': 'lineArrow',
  'comment.polyline': 'polyline',
  'comment.polygon': 'polygon',
  'comment.rectangle': 'square',
  'comment.oval': 'circle',
  'comment.cloud': 'cloud',
  'comment.pencil': 'ink',
  'comment.highlight': 'highlight',
  'comment.typewriter': 'typewriter', // its button arrived with the Comment ribbon (M6-08)
};

/** Every tool with a palette (the import/export order). */
export const PALETTE_TOOLS: readonly StyleTool[] = STYLE_TOOLS;

/**
 * The Comment Styles Palette window's tool list (M6-17), in groups as
 * PDF-XChange shows them. Every style tool is in exactly one group.
 */
export const TOOL_GROUPS: readonly { id: string; tools: readonly StyleTool[] }[] = [
  {
    id: 'drawings',
    tools: ['square', 'circle', 'line', 'lineArrow', 'polyline', 'polygon', 'cloud', 'ink'],
  },
  { id: 'textBoxes', tools: ['freeText', 'freeTextCallout', 'typewriter'] },
  {
    id: 'textMarkups',
    tools: ['highlight', 'underline', 'strikeout', 'squiggly', 'highlightArea', 'inkHighlighter'],
  },
  { id: 'notes', tools: ['textComment'] },
];

/** Each style tool's ribbon command (its icon in the window's tool list). */
export const TOOL_COMMANDS: Readonly<Record<StyleTool, string>> = {
  freeText: 'comment.textBox',
  typewriter: 'comment.typewriter',
  freeTextCallout: 'comment.callout',
  line: 'comment.line',
  lineArrow: 'comment.arrow',
  polyline: 'comment.polyline',
  polygon: 'comment.polygon',
  square: 'comment.rectangle',
  circle: 'comment.oval',
  cloud: 'comment.cloud',
  ink: 'comment.pencil',
  highlight: 'comment.highlight',
  underline: 'comment.underline',
  strikeout: 'comment.strikeout',
  squiggly: 'comment.squiggly',
  highlightArea: 'comment.highlightArea',
  inkHighlighter: 'comment.inkHighlighter',
  textComment: 'comment.stickyNote',
};

/** How a tool's presets and previews look. */
export type StyleKind =
  | 'text'
  | 'typewriter'
  | 'line'
  | 'shape'
  | 'cloud'
  | 'ink'
  | 'highlight'
  | 'markup'
  | 'area'
  | 'note';

export const KIND: Readonly<Record<StyleTool, StyleKind>> = {
  freeText: 'text',
  freeTextCallout: 'text',
  typewriter: 'typewriter',
  line: 'line',
  lineArrow: 'line',
  polyline: 'line',
  square: 'shape',
  circle: 'shape',
  polygon: 'shape',
  cloud: 'cloud',
  ink: 'ink',
  highlight: 'highlight',
  underline: 'markup',
  strikeout: 'markup',
  squiggly: 'markup',
  highlightArea: 'area',
  inkHighlighter: 'highlight',
  textComment: 'note',
};

/**
 * Tools whose comments share a style: a style picked from one restyles the
 * selected comments of any tool in its group (a rectangle's style suits an
 * oval, a line's an arrow), never across groups (a text style on a line).
 */
const GROUP: Readonly<Record<StyleTool, string>> = {
  freeText: 'text',
  freeTextCallout: 'text',
  typewriter: 'typewriter',
  line: 'line',
  lineArrow: 'line',
  polyline: 'line',
  square: 'shape',
  circle: 'shape',
  polygon: 'shape',
  cloud: 'shape',
  ink: 'ink',
  highlight: 'highlight',
  // A text line mark's style suits the others (an underline's colour on a strikeout).
  underline: 'textLine',
  strikeout: 'textLine',
  squiggly: 'textLine',
  highlightArea: 'highlightArea',
  inkHighlighter: 'inkHighlighter',
  textComment: 'note',
};

export const sameGroup = (a: StyleTool, b: StyleTool): boolean => GROUP[a] === GROUP[b];

export const PRESET_COLORS = [
  'red',
  'purple',
  'indigo',
  'blue',
  'green',
  'yellow',
  'black',
] as const;
export type PresetColor = (typeof PRESET_COLORS)[number];

export const PRESET_HEX: Readonly<Record<PresetColor, string>> = {
  red: '#FF0000',
  purple: '#800080',
  indigo: '#4B0082',
  blue: '#0000FF',
  green: '#008000',
  yellow: '#FFFF00',
  black: '#000000',
};

/**
 * Highlighter tints: a highlight multiplies onto the text (/BM /Multiply), so
 * a full-strength colour would hide it. Yellow is the shipped default; there
 * is no black highlighter (it would black the text out — that is redaction).
 */
export const HIGHLIGHT_HEX: Readonly<Partial<Record<PresetColor, string>>> = {
  red: '#FF9C9C',
  purple: '#E2A6F0',
  indigo: '#B6A8F5',
  blue: '#9CCBFF',
  green: '#A4EBA4',
  yellow: '#FFE14D',
};

/** Cloudy border intensity, as the Cloud tool and the grid's "Cloudy" write it (/BE /I). */
export const CLOUDY = 2;

export interface PresetStyle {
  /** `red`, `red-cloudy`, … (stable: e2e and the "current" mark use it). */
  id: string;
  color: PresetColor;
  cloudy: boolean;
  props: StyleProps;
}

function presetProps(kind: StyleKind, hex: string, cloudy: boolean): StyleProps {
  switch (kind) {
    case 'text':
      return { fontColor: hex, strokeColor: hex };
    case 'typewriter':
      return { fontColor: hex };
    case 'line':
    case 'cloud':
    case 'note':
      return { strokeColor: hex };
    case 'area':
      // A filled box without a border, multiplied onto the page.
      return { color: hex, strokeColor: hex };
    case 'shape':
      return cloudy
        ? {
            strokeColor: hex,
            cloudyBorderIntensity: CLOUDY,
            strokeStyle: PdfAnnotationBorderStyle.SOLID,
            strokeDashArray: [],
          }
        : { strokeColor: hex, cloudyBorderIntensity: 0 };
    case 'ink':
    case 'highlight':
    case 'markup':
      // /C is kept in both fields (EmbedPDF's `color` is a deprecated alias).
      return { strokeColor: hex, color: hex };
  }
}

/**
 * A tool's presets in palette order: the colours, then (closed shapes only)
 * their Cloudy variants. Text boxes have no Cloudy variant: EmbedPDF 2.15.1
 * has no cloudy border for free text, and our own appearance stream would
 * break §7.1.
 */
export function presetsFor(tool: StyleTool): PresetStyle[] {
  const kind = KIND[tool];
  const out: PresetStyle[] = [];
  for (const color of PRESET_COLORS) {
    const tint = kind === 'highlight' || kind === 'area';
    const hex = tint ? HIGHLIGHT_HEX[color] : PRESET_HEX[color];
    if (hex) out.push({ id: color, color, cloudy: false, props: presetProps(kind, hex, false) });
  }
  if (kind === 'shape')
    for (const color of PRESET_COLORS)
      out.push({
        id: `${color}-cloudy`,
        color,
        cloudy: true,
        props: presetProps(kind, PRESET_HEX[color], true),
      });
  return out;
}

/** Whether `current` (a tool's effective defaults) already has every property of `style`. */
export function isCurrent(style: StyleProps, current: StyleProps): boolean {
  const cur = current as Record<string, unknown>;
  return Object.entries(style).every(([k, v]) => {
    const c = cur[k];
    if (Array.isArray(v)) return Array.isArray(c) ? c.join() === v.join() : v.length === 0;
    if (typeof v === 'string' && typeof c === 'string') return v.toUpperCase() === c.toUpperCase();
    if (k === 'cloudyBorderIntensity' && v === 0) return c === undefined || c === 0;
    return c === v;
  });
}

// ------------------------------------------------------------ user styles

/**
 * A style in a tool's Custom Styles. Since M6-17 the presets are ordinary
 * styles too (the user may edit, rename, reorder or delete them): `preset` is
 * the preset it started as (Reset brings that look back), and an empty name
 * means "the preset's own, translated name".
 */
export interface UserStyle {
  id: string;
  name: string;
  props: StyleProps;
  preset?: string;
}

export type UserStyles = Partial<Record<StyleTool, UserStyle[]>>;

export const MAX_NAME = 64;
/** Per tool. */
export const MAX_STYLES = 64;
/** An import file larger than this is refused before it is parsed. */
export const MAX_FILE_BYTES = 256 * 1024;

/**
 * The stored record's schema version (IndexedDB `commentStyles`, keyed by tool
 * id). v1 (M6-07) held the user's own styles only; v2 (M6-17) holds the whole
 * list, the presets included.
 */
export const COMMENT_STYLES_VERSION = 2;

export interface StoredCommentStyles {
  v: typeof COMMENT_STYLES_VERSION;
  styles: UserStyle[];
}

/** A style name, trimmed, or null when empty or too long. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name.length > 0 && name.length <= MAX_NAME ? name : null;
}

/** The properties of `raw` when every one of them is well formed (and there is one), else null. */
function strictProps(raw: unknown): StyleProps | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const props = cleanProps(raw);
  const n = Object.keys(props).length;
  return n > 0 && n === Object.keys(raw).length ? props : null;
}

/** A preset's stable style id in a tool's list. */
export const presetStyleId = (preset: string): string => `preset:${preset}`;

/** A tool's list before the user changed anything: its presets, in palette order. */
export function seedStyles(tool: StyleTool): UserStyle[] {
  return presetsFor(tool).map((p) => ({
    id: presetStyleId(p.id),
    name: '',
    props: p.props,
    preset: p.id,
  }));
}

/** The preset a style started as (undefined for the user's own). */
export function presetOf(tool: StyleTool, style: UserStyle): PresetStyle | undefined {
  return style.preset === undefined
    ? undefined
    : presetsFor(tool).find((p) => p.id === style.preset);
}

/** Well-formed styles of a stored list; with `presets` a style may name its preset. */
function cleanStyles(list: readonly unknown[], tool: StyleTool, presets: boolean): UserStyle[] {
  const known = new Set(presetsFor(tool).map((p) => p.id));
  const out: UserStyle[] = [];
  const ids = new Set<string>();
  for (const s of list) {
    if (typeof s !== 'object' || s === null) continue;
    const { id, name, props, preset } = s as Record<string, unknown>;
    const isPreset = presets && typeof preset === 'string' && known.has(preset);
    const n = isPreset && name === '' ? '' : cleanName(name);
    const p = cleanProps(props);
    if (typeof id !== 'string' || !id || ids.has(id) || n === null) continue;
    if (Object.keys(p).length === 0) continue;
    ids.add(id);
    out.push(isPreset ? { id, name: n, props: p, preset } : { id, name: n, props: p });
  }
  return out;
}

/**
 * A tool's list from its stored record: v2 as stored (well-formed styles
 * only); v1 (M6-07: the user's own styles) after the presets; no record, or
 * one this version cannot read, is the presets alone.
 */
export function migrateStyles(raw: unknown, tool: StyleTool): UserStyle[] {
  if (typeof raw !== 'object' || raw === null) return seedStyles(tool);
  const r = raw as { v?: unknown; styles?: unknown };
  if (!Array.isArray(r.styles)) return seedStyles(tool);
  if (r.v === 1)
    return [...seedStyles(tool), ...cleanStyles(r.styles as unknown[], tool, false)].slice(
      0,
      MAX_STYLES,
    );
  if (r.v !== COMMENT_STYLES_VERSION) return seedStyles(tool);
  return cleanStyles(r.styles as unknown[], tool, true).slice(0, MAX_STYLES);
}

/** Reset (M6-17): a preset back to its own look and name; the user's own styles are kept. */
export function resetStyle(tool: StyleTool, style: UserStyle): UserStyle {
  const p = presetOf(tool, style);
  return p ? { ...style, name: '', props: p.props } : style;
}

/** Whether a style is a preset as shipped (nothing to reset, nothing to export). */
export function isPristine(tool: StyleTool, style: UserStyle): boolean {
  const p = presetOf(tool, style);
  return !!p && style.name === '' && sameProps(style.props, p.props);
}

/** Two property sets with the same properties and values (any key order). */
export const sameProps = (a: StyleProps, b: StyleProps): boolean =>
  Object.keys(a).length === Object.keys(b).length && isCurrent(a, b) && isCurrent(b, a);

/** Reset All (M6-17): the presets as shipped, in order, then the user's own styles. */
export function restorePresets(tool: StyleTool, list: readonly UserStyle[]): UserStyle[] {
  return [...seedStyles(tool), ...list.filter((s) => s.preset === undefined)].slice(0, MAX_STYLES);
}

/** The first free "‹base› copy", "‹base› copy 2", … name (`nameOf` translates). */
export function cloneName(
  taken: readonly string[],
  base: string,
  nameOf: (base: string, n: number) => string,
): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const name = nameOf(base, n).slice(0, MAX_NAME).trim();
    if (!used.has(name)) return name;
  }
}

/** `list` with `style` put right after the style `after` (or at the end). */
export function insertAfter(
  list: readonly UserStyle[],
  after: string | null,
  style: UserStyle,
): UserStyle[] {
  const at = after === null ? -1 : list.findIndex((s) => s.id === after);
  const out = [...list];
  out.splice(at < 0 ? out.length : at + 1, 0, style);
  return out;
}

/** `list` with the style `id` moved by `delta` places (clamped), or the same list. */
export function moveStyle(list: readonly UserStyle[], id: string, delta: number): UserStyle[] {
  const from = list.findIndex((s) => s.id === id);
  if (from < 0) return [...list];
  const to = Math.min(list.length - 1, Math.max(0, from + delta));
  const out = [...list];
  const [s] = out.splice(from, 1);
  if (s) out.splice(to, 0, s);
  return out;
}

// ------------------------------------------------------------ export / import

export const STYLE_FILE_FORMAT = 'pdftools-styles';
export const STYLE_FILE_VERSION = 1;
export const STYLE_FILE_SUFFIX = '.pdftools-styles.json';

export type StyleFileError =
  'tooLarge' | 'json' | 'format' | 'version' | 'tool' | 'style' | 'empty' | 'tooMany';

/**
 * The export file: every tool's styles (names and properties; ids are local).
 * Presets as shipped are left out (every copy of the app has them); a changed
 * preset goes as a style of its own under its shown name (`nameOf`).
 */
export function serializeStyles(
  styles: UserStyles,
  nameOf: (tool: StyleTool, style: UserStyle) => string,
): string {
  const tools: Record<string, { name: string; props: StyleProps }[]> = {};
  for (const tool of PALETTE_TOOLS) {
    const list = (styles[tool] ?? []).filter((s) => !isPristine(tool, s));
    if (list.length) tools[tool] = list.map((s) => ({ name: nameOf(tool, s), props: s.props }));
  }
  return `${JSON.stringify({ format: STYLE_FILE_FORMAT, version: STYLE_FILE_VERSION, tools }, null, 2)}\n`;
}

export interface ParsedStyles {
  styles: UserStyles;
  count: number;
}

/**
 * An import file's styles, with fresh ids; the whole file is refused on the
 * first problem (nothing half-imported), with every problem found.
 */
export function parseStyles(
  text: string,
  newId: () => string,
): { ok: true; value: ParsedStyles } | { ok: false; errors: StyleFileError[] } {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES)
    return { ok: false, errors: ['tooLarge'] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['json'] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, errors: ['format'] };
  const r = raw as Record<string, unknown>;
  if (r['format'] !== STYLE_FILE_FORMAT) return { ok: false, errors: ['format'] };
  if (r['version'] !== STYLE_FILE_VERSION) return { ok: false, errors: ['version'] };
  const tools = r['tools'];
  if (typeof tools !== 'object' || tools === null || Array.isArray(tools))
    return { ok: false, errors: ['format'] };
  const errors = new Set<StyleFileError>();
  const styles: UserStyles = {};
  let count = 0;
  for (const [tool, list] of Object.entries(tools)) {
    if (!isStyleTool(tool)) {
      errors.add('tool');
      continue;
    }
    if (!Array.isArray(list)) {
      errors.add('style');
      continue;
    }
    if (list.length > MAX_STYLES) errors.add('tooMany');
    const out: UserStyle[] = [];
    for (const s of list as unknown[]) {
      const rec = typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {};
      const name = cleanName(rec['name']);
      const props = strictProps(rec['props']);
      if (!name || !props) errors.add('style');
      else out.push({ id: newId(), name, props });
    }
    if (out.length) styles[tool] = out;
    count += out.length;
  }
  if (errors.size) return { ok: false, errors: [...errors] };
  if (count === 0) return { ok: false, errors: ['empty'] };
  return { ok: true, value: { styles, count } };
}

/**
 * The user's styles with `add` appended per tool, or null when a tool would
 * pass MAX_STYLES. `listOf` gives a tool's list (the presets when not stored).
 */
export function mergeStyles(
  listOf: (tool: StyleTool) => readonly UserStyle[],
  add: UserStyles,
): UserStyles | null {
  const out: UserStyles = {};
  for (const tool of PALETTE_TOOLS) {
    const extra = add[tool];
    if (!extra?.length) continue;
    const merged = [...listOf(tool), ...extra];
    if (merged.length > MAX_STYLES) return null;
    out[tool] = merged;
  }
  return out;
}

// ------------------------------------------------------------ swatch grid

/** The palette's rows of item indices: each section in rows of `cols`, then single-item rows. */
export function gridRows(sections: readonly number[], cols: number, tail = 0): number[][] {
  const rows: number[][] = [];
  let i = 0;
  for (const n of sections) {
    for (let r = 0; r < n; r += cols) {
      const row: number[] = [];
      for (let c = r; c < Math.min(n, r + cols); c++) row.push(i + c);
      rows.push(row);
    }
    i += n;
  }
  for (let k = 0; k < tail; k++) rows.push([i + k]);
  return rows;
}

/**
 * Where an arrow key, Home or End moves from item `current` (APG grid):
 * Left/Right step through the items in reading order, Up/Down keep the column
 * (the nearest one in a shorter row), the edges stop. undefined: not a move key.
 */
export function gridMove(
  rows: readonly number[][],
  current: number,
  key: string,
): number | undefined {
  const all = rows.flat();
  const last = all.length - 1;
  if (last < 0) return undefined;
  const at = all.indexOf(current);
  const pos = at < 0 ? 0 : at;
  switch (key) {
    case 'Home':
      return all[0];
    case 'End':
      return all[last];
    case 'ArrowRight':
      return all[Math.min(last, pos + 1)];
    case 'ArrowLeft':
      return all[Math.max(0, pos - 1)];
    case 'ArrowUp':
    case 'ArrowDown': {
      const r = rows.findIndex((row) => row.includes(current));
      if (r < 0) return all[0];
      const row = rows[r] ?? [];
      const col = row.indexOf(current);
      const next = rows[key === 'ArrowUp' ? r - 1 : r + 1];
      if (!next) return current;
      return next[Math.min(col, next.length - 1)];
    }
    default:
      return undefined;
  }
}
