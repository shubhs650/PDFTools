import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// M7-11 (ADR-023 D-42): every token pair the UI draws text or controls with
// meets WCAG AA in both themes — 4.5:1 for text, 3:1 for icons, focus rings,
// borders that mark a control and other UI parts (WCAG 1.4.3, 1.4.11).

const tokens = readFileSync('src/ui/tokens.css', 'utf8');

function block(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = tokens.slice(start, tokens.indexOf('\n}', start));
  return new Map(
    [...body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

const light = block(':root');
const dark = new Map([...light, ...block(":root[data-theme='dark']")]);

type Rgb = [number, number, number];
function rgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) throw new Error(`not an opaque #rrggbb colour: ${value}`);
  const n = parseInt(hex[1] ?? '', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = ([r, g, b]: Rgb): number => {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Every background the app's text sits on. */
const SURFACES = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-hover',
  '--color-pressed',
  '--color-selected',
];
const PANES = ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-sunken'];

const TEXT_PAIRS: [string, string[]][] = [
  ['--color-text', SURFACES],
  ['--color-text-muted', SURFACES],
  ['--color-link', PANES],
  ['--color-danger', PANES],
  ['--color-text-on-brand', ['--color-brand', '--color-brand-hover']],
  ['--color-tooltip-text', ['--color-tooltip-bg']],
  ['--color-find-hit-text', ['--color-find-hit', '--color-find-current']],
  ['--color-form-text', ['--color-form-field', '--color-page']],
  ['--color-note-text', ['--color-note-paper']],
];
const UI_PAIRS: [string, string[]][] = [
  ['--color-icon', SURFACES],
  ['--color-focus', PANES],
  ['--color-accent', [...PANES, '--color-selected']],
  ['--color-border-strong', ['--color-bg', '--color-surface', '--color-surface-raised']],
  ['--color-danger', PANES],
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast (WCAG AA)', (_name, set) => {
  const get = (t: string): string => {
    const v = set.get(t);
    if (!v) throw new Error(`missing ${t}`);
    return v;
  };
  it('text tokens reach 4.5:1 on every background they are drawn on', () => {
    const fails: string[] = [];
    for (const [fg, bgs] of TEXT_PAIRS)
      for (const bg of bgs) {
        const c = contrast(get(fg), get(bg));
        if (c < 4.5) fails.push(`${fg} on ${bg}: ${c.toFixed(2)}`);
      }
    expect(fails).toEqual([]);
  });
  it('icons, focus rings, accents and control borders reach 3:1', () => {
    const fails: string[] = [];
    for (const [fg, bgs] of UI_PAIRS)
      for (const bg of bgs) {
        const c = contrast(get(fg), get(bg));
        if (c < 3) fails.push(`${fg} on ${bg}: ${c.toFixed(2)}`);
      }
    expect(fails).toEqual([]);
  });
});

describe('the page in dark (M7-11)', () => {
  it('keeps the light colours on the white page, outside forced-colors mode', () => {
    const at = tokens.indexOf('@media not (forced-colors: active)');
    expect(at).toBeGreaterThan(-1);
    const start = tokens.indexOf(":root[data-theme='dark'] .page {", at);
    expect(start).toBeGreaterThan(at);
    const body = tokens.slice(start, tokens.indexOf('\n  }', start));
    expect(body).toContain('color-scheme: light;');
    const page = new Map(
      [...body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
    );
    expect(page).toEqual(light);
  });
});
