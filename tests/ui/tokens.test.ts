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
