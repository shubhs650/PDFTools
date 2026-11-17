import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENT_BRAND, ACCENTS } from '../../src/app/theme';
import { ICON_ACCENT_ROLES } from '../../src/ui/icons/accents';

// M7-11 (ADR-023 D-42): every token pair the UI draws text or controls with
// meets WCAG AA in both themes — 4.5:1 for text, 3:1 for icons, focus rings,
// borders that mark a control and other UI parts (WCAG 1.4.3, 1.4.11).

const tokens = readFileSync('src/ui/tokens.css', 'utf8');

function block(selector: string): Map<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  // Token blocks hold no nested braces: the first one closes the block.
  const body = tokens.slice(start, tokens.indexOf('}', start));
  return new Map(
    [...body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

const light = block(':root');
const dark = new Map([...light, ...block(":root[data-theme='dark']")]);

// The accent colours (M10 O7, D-47): Blue is the sets above; each other accent's light
// block applies in both themes and its dark block (more specific) overrides it in dark.
const OTHER_ACCENTS = ACCENTS.filter((a) => a !== 'blue');
const accentLight = (a: string) => block(`:root[data-accent='${a}']`);
const accentDark = (a: string) => block(`:root[data-accent='${a}'][data-theme='dark']`);
const SETS: [string, Map<string, string>][] = [
  ['light', light],
  ['dark', dark],
  ...OTHER_ACCENTS.flatMap((a): [string, Map<string, string>][] => [
    [`${a} light`, new Map([...light, ...accentLight(a)])],
    [`${a} dark`, new Map([...dark, ...accentLight(a), ...accentDark(a)])],
  ]),
];

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
  '--color-surface-subtle',
  '--color-hover',
  '--color-pressed',
  '--color-selected',
];
const PANES = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-sunken',
  '--color-surface-subtle',
];

const TEXT_PAIRS: [string, string[]][] = [
  ['--color-text', SURFACES],
  ['--color-text-muted', SURFACES],
  ['--color-link', PANES],
  // M10-04 (D-47): a pressed toggle's label and icon on its tint (and hovered), and the
  // active ribbon tab's label on the title rows.
  [
    '--color-selected-text',
    [...PANES, '--color-hover', '--color-selected', '--color-selected-hover'],
  ],
  ['--color-danger', PANES],
  // M10-06: the status bar's "Ready offline" pill.
  ['--color-success-text', ['--color-success-bg']],
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
  // M10-04: a focus ring on a pressed toggle that is hovered.
  ['--color-focus', ['--color-selected-hover']],
  // A control's edge (inputs, check boxes, colour buttons) on every surface it sits on.
  ['--color-border-strong', [...PANES, '--color-hover']],
  ['--color-danger', PANES],
  // M10-08·O1: the icon accents on every pane and on a hovered or pressed button or menu
  // item (a pressed toggle drops its accent, so --color-selected is not among them).
  ...ICON_ACCENT_ROLES.map((r): [string, string[]] => [
    `--color-icon-${r}`,
    [...PANES, '--color-hover', '--color-pressed'],
  ]),
];

describe.each(SETS)('%s theme contrast (WCAG AA)', (_name, set) => {
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

// M11-03 (ADR-028 D-50): the selected file tab is filled with the accent (--color-brand)
// and has a 2 px --color-accent line along its bottom on the sunken strip. Its name and
// × are --color-text-on-brand; the × hovers to --color-brand-hover. Other tabs hover to
// --color-surface-raised and their × (in --color-text) to --color-pressed. The hover card is a raised
// surface with muted text and the "Unsaved changes" chip in the selected tint.
describe.each(SETS)('%s file tabs (M11-03)', (_name, set) => {
  const get = (t: string): string => {
    const v = set.get(t);
    if (!v) throw new Error(`missing ${t}`);
    return v;
  };
  it('the selected tab name and × read on the fill (4.5:1), hovered too', () => {
    expect(contrast(get('--color-text-on-brand'), get('--color-brand'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(get('--color-text-on-brand'), get('--color-brand-hover')),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it('the selected tab stands out from the strip by 3:1: its line always does', () => {
    expect(contrast(get('--color-accent'), get('--color-surface-sunken'))).toBeGreaterThanOrEqual(
      3,
    );
  });
  it('other tabs, the + and the hover card keep their text at 4.5:1', () => {
    for (const bg of ['--color-surface-sunken', '--color-surface-raised', '--color-pressed'])
      expect(contrast(get('--color-text'), get(bg)), bg).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(get('--color-text-muted'), get('--color-surface-raised')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(get('--color-selected-text'), get('--color-selected'))).toBeGreaterThanOrEqual(
      4.5,
    );
    for (const bg of ['--color-surface-sunken', '--color-surface-raised', '--color-pressed'])
      expect(contrast(get('--color-icon'), get(bg)), bg).toBeGreaterThanOrEqual(3);
  });
  it('the unsaved dot shows on an unselected tab (3:1)', () => {
    for (const bg of ['--color-surface-sunken', '--color-surface-raised'])
      expect(contrast(get('--color-accent'), get(bg)), bg).toBeGreaterThanOrEqual(3);
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

/** The tokens an accent may change; everything else (neutrals, page, comments) never follows it. */
const ACCENT_TOKENS = [
  '--color-selected',
  '--color-selected-hover',
  '--color-selected-text',
  '--color-accent',
  '--color-link',
  '--color-brand',
  '--color-brand-hover',
  '--color-focus',
  '--color-focus-halo',
];

describe('accent colours (M10 O7)', () => {
  it('tokens.css has a light and a dark set for every accent but Blue, and no other', () => {
    const named = new Set([...tokens.matchAll(/data-accent='(\w+)'/g)].map((m) => m[1]));
    expect([...named].sort()).toEqual([...OTHER_ACCENTS].sort());
  });

  it.each(OTHER_ACCENTS)('%s changes only the accent tokens, in both themes', (a) => {
    expect([...accentLight(a).keys()]).toEqual(ACCENT_TOKENS);
    expect([...accentDark(a).keys()]).toEqual(ACCENT_TOKENS);
  });

  it.each(OTHER_ACCENTS)('%s keeps its light colours on the white page in dark', (a) => {
    expect(block(`:root[data-accent='${a}'][data-theme='dark'] .page`)).toEqual(accentLight(a));
  });

  it('the accent sets stay out of forced-colors mode', () => {
    const at = tokens.indexOf("[data-accent='");
    const media = tokens.lastIndexOf('@media', at);
    expect(tokens.slice(media, at)).toMatch(/^@media not \(forced-colors: active\) \{/);
  });

  it('each accent has one filled brand in both themes, as theme.ts and the swatch say', () => {
    const swatches = new Map(
      [...tokens.matchAll(/(--accent-swatch-\w+)\s*:\s*([^;]+);/g)].map((m) => [
        m[1] ?? '',
        m[2] ?? '',
      ]),
    );
    for (const a of ACCENTS) {
      const [l, d] =
        a === 'blue'
          ? [light, dark]
          : [
              new Map([...light, ...accentLight(a)]),
              new Map([...dark, ...accentLight(a), ...accentDark(a)]),
            ];
      expect(l.get('--color-brand'), a).toBe(ACCENT_BRAND[a]);
      expect(d.get('--color-brand'), a).toBe(ACCENT_BRAND[a]);
      expect(swatches.get(`--accent-swatch-${a}`), a).toBe(ACCENT_BRAND[a]);
    }
  });

  it('every accent is told apart from the others in each theme', () => {
    for (const [name, set] of SETS) {
      const others = SETS.filter(([n]) => n !== name && n.endsWith(name.split(' ').pop() ?? ''));
      for (const [other, o] of others)
        expect(set.get('--color-accent'), `${name} vs ${other}`).not.toBe(o.get('--color-accent'));
    }
  });
});

// M10-03 (D-47): the form controls' marks are images, so their colours are written into
// tokens.css; they must stay the token colours they stand for, in each theme.
describe('form control marks (M10-03)', () => {
  /** The stroke colour of a `--image-…` data-URI token in a block. */
  function stroke(selector: string, name: string): string {
    const start = tokens.indexOf(`${selector} {`);
    const body = tokens.slice(start, tokens.indexOf('\n}', start));
    const m = new RegExp(`${name}:\\s*url\\("[^"]*stroke='%23([0-9a-f]{6})'`).exec(body);
    if (!m) throw new Error(`no ${name} in ${selector}`);
    return `#${m[1] ?? ''}`;
  }

  it('the tick is --color-text-on-brand, the same in every theme and accent', () => {
    const tick = stroke(':root', '--image-check');
    for (const [name, set] of SETS) expect(set.get('--color-text-on-brand'), name).toBe(tick);
  });

  it('the chevron is --color-icon, and --color-text-disabled when disabled, in each theme', () => {
    for (const [selector, set] of [
      [':root', light],
      [":root[data-theme='dark']", dark],
    ] as const) {
      expect(stroke(selector, '--image-chevron'), selector).toBe(set.get('--color-icon'));
      expect(stroke(selector, '--image-chevron-disabled'), selector).toBe(
        set.get('--color-text-disabled'),
      );
    }
  });
});
