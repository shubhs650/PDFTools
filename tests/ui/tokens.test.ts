import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync('src/ui/tokens.css', 'utf8');
const componentDir = 'src/ui/components';
const componentCss = readdirSync(componentDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ file: f, text: readFileSync(join(componentDir, f), 'utf8') }));
const componentTsx = readdirSync(componentDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ file: f, text: readFileSync(join(componentDir, f), 'utf8') }));

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): string {
  const start = tokens.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  return tokens.slice(start, tokens.indexOf('\n}', start));
}

const declared = (css: string): string[] =>
  [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] ?? '');

describe('design tokens (§8)', () => {
  it('component styles use no color or size literals', () => {
    for (const { file, text } of componentCss) {
      const css = stripComments(text);
      expect(css.match(/#[0-9a-f]{3,8}\b/gi), `${file}: hex colors`).toBeNull();
      expect(css.match(/\b(rgb|rgba|hsl|hsla|oklch)\(/g), `${file}: color functions`).toBeNull();
      expect(css.match(/\b\d+(\.\d+)?(px|rem|em|pt)\b/g), `${file}: sizes`).toBeNull();
    }
  });

  it('components set no inline color or size literals', () => {
    for (const { file, text } of componentTsx) {
      expect(text.match(/#[0-9a-f]{3,8}\b/gi), `${file}: hex colors`).toBeNull();
      expect(text.match(/\b\d+(px|rem|em)\b/g), `${file}: sizes`).toBeNull();
    }
  });

  it('every token a component uses is defined', () => {
    const defined = new Set(declared(block(':root')));
    for (const { file, text } of componentCss) {
      for (const m of text.matchAll(/var\((--[\w-]+)\)/g)) {
        expect(defined.has(m[1] ?? ''), `${file}: ${m[1] ?? ''}`).toBe(true);
      }
    }
  });

  it('the dark set overrides every color token, and so does forced-colors', () => {
    const colors = declared(block(':root')).filter((t) => t.startsWith('--color-'));
    const dark = new Set(declared(block(":root[data-theme='dark']")));
    expect(colors.filter((c) => !dark.has(c))).toEqual([]);
    const forced = tokens.slice(tokens.indexOf('@media (forced-colors: active)'));
    const forcedSet = new Set(declared(forced.slice(0, forced.indexOf('\n}\n'))));
    expect(colors.filter((c) => !forcedSet.has(c))).toEqual([]);
  });
});

// M7-11 (ADR-023 D-42): the app's own styles and components take every colour
// from the tokens, so both themes (and forced-colors) reach every surface.
function walk(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return walk(path, ext);
    return e.name.endsWith(ext) ? [path] : [];
  });
}

/** Colours that are not UI: the app icon's artwork and colours written into the document. */
const DOCUMENT_COLOURS = new Set([
  'src/app/TopBar.tsx', // AppMark: public/icons/icon.svg drawn inline
  'src/features/stamps/schemes/SchemesDialog.tsx', // a new status code's stamp colour
]);
const NAMED = /:\s*[^;{}]*\b(white|black|red|green|blue|yellow|orange|gray|grey|silver|navy)\b/g;

describe('no hard-coded colours (M7-11)', () => {
  it('app.css uses tokens only', () => {
    const css = stripComments(readFileSync('src/app/app.css', 'utf8')).replace(
      /white-space:[^;]*;/g,
      '',
    );
    expect(css.match(/#[0-9a-f]{3,8}\b/gi), 'hex colors').toBeNull();
    expect(css.match(/\b(rgb|rgba|hsl|hsla|oklch|lab|lch)\(/g), 'color functions').toBeNull();
    expect(css.match(NAMED), 'named colors').toBeNull();
  });

  it('every token app.css uses is defined', () => {
    const defined = new Set(declared(block(':root')));
    const missing = [...readFileSync('src/app/app.css', 'utf8').matchAll(/var\((--[\w-]+)/g)]
      .map((m) => m[1] ?? '')
      .filter((t) => !defined.has(t));
    // Custom properties a component sets itself (e.g. --note-color) are not tokens.
    expect(missing.filter((t) => t.startsWith('--color-'))).toEqual([]);
  });

  it('components set no literal colours', () => {
    const offenders = walk('src', '.tsx')
      .filter((f) => !f.startsWith(join('src', 'testing')))
      .filter((f) => !DOCUMENT_COLOURS.has(f.split('\\').join('/')))
      .filter((f) => /['"`]#[0-9a-f]{3,8}\b/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
