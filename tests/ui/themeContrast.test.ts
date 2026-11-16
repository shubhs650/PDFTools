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
const toHex = (c: Rgb): string =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** A translucent `rgb(r g b / a)` token painted over an opaque background. */
function over(value: string, background: string): string {
  const m = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value.trim());
  if (!m) throw new Error(`not an rgb(r g b / a) colour: ${value}`);
  const a = Number(m[4]);
  const bg = rgb(background);
  return toHex([0, 1, 2].map((i) => Number(m[i + 1]) * a + (bg[i] ?? 0) * (1 - a)) as Rgb);
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
  // M10-02 (D-47): a focus ring also shows on a hovered, pressed or selected row.
  ['--color-focus', SURFACES],
  ['--color-accent', [...PANES, '--color-selected', '--color-hover']],
  // A control's edge (inputs, check boxes, colour buttons) on every surface it sits on.
  ['--color-border-strong', [...PANES, '--color-hover']],
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
  // M10-02 (D-47): the soft halo outside the focus ring must not swallow it.
  it('the focus ring stands out from its halo by 3:1 on every pane', () => {
    const fails: string[] = [];
    for (const bg of PANES) {
      const halo = over(get('--color-focus-halo'), get(bg));
      const c = contrast(get('--color-focus'), halo);
      if (c < 3) fails.push(`--color-focus on its halo over ${bg}: ${c.toFixed(2)}`);
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
