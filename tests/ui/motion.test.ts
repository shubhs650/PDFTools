// Motion rules (M10-07, ADR-027 D-47), checked on the stylesheets themselves:
// token durations only (so prefers-reduced-motion stops everything), opacity and
// transform only in keyframes, colour-only transitions, and nothing animated in the
// document view.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return walk(path);
    return e.name.endsWith('.css') ? [path] : [];
  });
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = walk('src').map((file) => ({
  file: file.split('\\').join('/'),
  css: stripComments(readFileSync(file, 'utf8')),
}));

interface Decl {
  file: string;
  selector: string;
  property: 'animation' | 'transition';
  value: string;
  reduced: boolean;
}

/** Every `animation` and `transition` declaration, with its rule's selector. */
function declarations(): Decl[] {
  const out: Decl[] = [];
  for (const { file, css } of sheets) {
    const body = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? '').trim().replace(/\s+/g, ' ');
      // Is this rule inside a reduced-motion block? (The nearest @media before it is a
      // prefers-reduced-motion query whose block is still open: more { than } since.)
      const before = body.slice(0, m.index);
      const lastMedia = before.lastIndexOf('@media');
      const open = before.indexOf('{', lastMedia);
      const since = before.slice(open);
      const reduced =
        lastMedia >= 0 &&
        open >= 0 &&
        body.slice(lastMedia, open).includes('prefers-reduced-motion') &&
        (since.match(/\{/g) ?? []).length > (since.match(/\}/g) ?? []).length;
      for (const d of (m[2] ?? '').matchAll(/(?:^|;)\s*(animation|transition)\s*:\s*([^;]+)/g)) {
        out.push({
          file,
          selector,
          property: d[1] as Decl['property'],
          value: (d[2] ?? '').trim().replace(/\s+/g, ' '),
          reduced,
        });
      }
    }
  }
  return out;
}

const decls = declarations();
const parts = (value: string) => value.split(/,(?![^(]*\))/).map((p) => p.trim());

/** Infinite spinners and the loading shimmer (O5): their own reduced-motion rule
 *  stops them (checked below). */
const SPINNERS = new Set(['ui-spin', 'offline-spin', 'ui-shimmer']);

describe('motion (M10-07, D-47)', () => {
  it('prefers-reduced-motion sets every duration token to 0 ms', () => {
    const tokens = stripComments(readFileSync('src/ui/tokens.css', 'utf8'));
    const start = tokens.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(0);
    const block = tokens.slice(start, tokens.indexOf('\n}\n', start));
    const root = tokens.slice(
      tokens.indexOf(':root {'),
      tokens.indexOf('\n}', tokens.indexOf(':root {')),
    );
    const durations = [...root.matchAll(/(--duration-[\w-]+)\s*:/g)].map((m) => m[1] ?? '');
    expect(durations).toEqual(['--duration-fast', '--duration-normal', '--duration-slow']);
    for (const d of durations) expect(block).toMatch(new RegExp(`${d}:\\s*0ms`));
  });

  it('every animation and transition takes its duration from a motion token', () => {
    const offenders = decls
      .filter((d) => !d.reduced && d.value !== 'none')
      .flatMap((d) => parts(d.value).map((p) => ({ ...d, p })))
      .filter(({ p }) => {
        const name = p.split(' ')[0] ?? '';
        if (SPINNERS.has(name)) return false;
        return !/var\(--duration-(fast|normal|slow)\)/.test(p);
      })
      .map(({ file, selector, p }) => `${file} ${selector}: ${p}`);
    expect(offenders).toEqual([]);
  });

  it('spinners stop under prefers-reduced-motion', () => {
    const stopped = decls.filter((d) => d.reduced && d.value === 'none').map((d) => d.selector);
    for (const name of SPINNERS) {
      const spinning = decls.filter((d) => !d.reduced && d.value.startsWith(`${name} `));
      expect(spinning.length, name).toBeGreaterThan(0);
      for (const d of spinning) expect(stopped, `${d.selector} (${name})`).toContain(d.selector);
    }
  });

  it('keyframes animate opacity and transform only', () => {
    const offenders: string[] = [];
    for (const { file, css } of sheets) {
      for (const k of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
        for (const p of (k[2] ?? '').matchAll(/([\w-]+)\s*:/g)) {
          if (!['opacity', 'transform'].includes(p[1] ?? ''))
            offenders.push(`${file} @keyframes ${k[1] ?? ''}: ${p[1] ?? ''}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('transitions change colour, opacity or transform only (small, paint-only areas)', () => {
    // Older, deliberate exceptions on small elements.
    const allowed = new Set([
      '.ui-progress-bar width', // a progress bar's fill, inside a dialog
      '.start-action box-shadow', // a start-screen card's hover lift (M10-05)
    ]);
    const ok = ['opacity', 'transform', 'background-color', 'color', 'border-color'];
    const offenders = decls
      .filter((d) => d.property === 'transition' && !d.reduced)
      .flatMap((d) => parts(d.value).map((p) => ({ ...d, prop: p.split(' ')[0] ?? '' })))
      .filter(({ selector, prop }) => !ok.includes(prop) && !allowed.has(`${selector} ${prop}`))
      .map(({ file, selector, prop }) => `${file} ${selector}: ${prop}`);
    expect(offenders).toEqual([]);
  });

  // The one animation that reaches the document view is the loading placeholder
  // (M10-08·O5, .ui-placeholder): it exists only while a page has no image yet, so a
  // rendered page, zooming, scrolling and drawing never animate.
  it('only the reviewed surfaces animate, and nothing in the document view', () => {
    const animated = decls
      .filter((d) => d.property === 'animation' && !d.reduced && d.value !== 'none')
      .map((d) => d.selector)
      .sort();
    expect(animated).toEqual(
      [
        ".backstage[data-state='open']",
        '.drop-overlay-card',
        '.left-pane-body > *, .properties-pane > :not(.pane-header)',
        '.offline-spinner',
        '.ribbon-toolbar > .ribbon-group',
        '.snapshot-toast',
        '.thumb-img',
        ".ui-dialog-backdrop[data-state='open']",
        ".ui-dialog[data-state='open']",
        ".ui-menu[data-state='open'], .ui-color-popup[data-state='open']",
        '.ui-placeholder',
        '.ui-placeholder::after',
        '.ui-spinner',
        ".ui-tooltip[data-state='delayed-open']",
      ].sort(),
    );
    const documentView =
      /\.(page|document-view|annot|measure|snapshot-rect|link-hit|redact-mark|tile|form-field)\b/;
    const inDocument = decls
      // (An exclusion such as `:not(.form-field)` names the document only to leave it out.)
      .filter(
        (d) =>
          !d.reduced &&
          d.value !== 'none' &&
          documentView.test(d.selector.replace(/:not\((?:[^()]*|\([^()]*\))*\)/g, '')),
      )
      .map((d) => `${d.file} ${d.selector}`);
    expect(inDocument).toEqual([]);
  });

  it('a surface animates only while open, so closing never waits (Radix Presence)', () => {
    const radix = decls.filter(
      (d) =>
        d.property === 'animation' &&
        /\.ui-(menu|tooltip|dialog|color-popup)|\.backstage/.test(d.selector),
    );
    expect(radix.length).toBeGreaterThan(0);
    for (const d of radix)
      expect(d.selector, d.selector).toMatch(/\[data-state='(open|delayed-open)'\]/);
  });
});
