// M0-S6: tree-shaken bundle cost of the chosen icon set. Builds small Vite
// library bundles (React external, minified) and reports raw/gzip/brotli.
//
// Usage: node spikes/s6-icons/bundle.ts → spikes/s6-icons/out/s6-bundle.json

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build } from 'vite';
import { loadCatalog, resolve, SMALL, type Style } from './catalog.ts';
import { COMMANDS } from './commands.ts';

const here = import.meta.dirname;
const out = join(here, 'out', 'bundle');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const cat = loadCatalog();
const resolved = COMMANDS.map((c) => resolve(c, cat));

/** Export names (and their atom files) for the whole command set in the given style policy. */
function iconSet(pick: (r: (typeof resolved)[number]) => Style): Map<string, string> {
  const names = new Map<string, string>();
  for (const r of resolved) {
    if (!r.entry) continue;
    const style = pick(r);
    const fit = r.fit[style];
    names.set(`${r.cmd.fluent}${String(SMALL)}${style}`, r.entry.atom);
    if (r.cmd.size === 'large' && fit.large)
      names.set(`${r.cmd.fluent}${String(fit.large)}${style}`, r.entry.atom);
  }
  return names;
}

const regular = iconSet(() => 'Regular');
const colorPreferred = iconSet((r) => (r.fit.Color.ok ? 'Color' : 'Regular'));
const [firstName, firstAtom] = [...regular][0] ?? ['', ''];

const rootEntry = (names: Iterable<string>): string => {
  const list = [...names];
  return `import { ${list.join(', ')} } from '@fluentui/react-icons';\nexport const icons = [${list.join(', ')}];\n`;
};
const atomEntry = (names: Map<string, string>): string => {
  const lines = [...names].map(
    ([n, atom]) => `import { ${n} } from '@fluentui/react-icons/svg/${atom}';`,
  );
  return `${lines.join('\n')}\nexport const icons = [${[...names.keys()].join(', ')}];\n`;
};

const variants: Record<string, string> = {
  'baseline-one-icon': atomEntry(new Map([[firstName, firstAtom]])),
  'regular-root-import': rootEntry(regular.keys()),
  'regular-atom-imports': atomEntry(regular),
  'color-preferred-root-import': rootEntry(colorPreferred.keys()),
};

const r1 = (n: number): number => Math.round(n / 100) / 10;
const results: Record<string, unknown> = {
  icons: { regular: regular.size, colorPreferred: colorPreferred.size },
};
for (const [name, src] of Object.entries(variants)) {
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'entry.js'), src);
  const t0 = performance.now();
  await build({
    configFile: false,
    logLevel: 'silent',
    root: dir,
    build: {
      outDir: join(dir, 'dist'),
      emptyOutDir: true,
      minify: true,
      lib: { entry: join(dir, 'entry.js'), formats: ['es'], fileName: 'icons' },
      rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom'] },
    },
  });
  const files = readdirSync(join(dir, 'dist')).filter((f) => f.endsWith('.js'));
  const bytes = Buffer.concat(files.map((f) => readFileSync(join(dir, 'dist', f))));
  results[name] = {
    kB: r1(bytes.length),
    gzipKB: r1(gzipSync(bytes, { level: 9 }).length),
    brotliKB: r1(
      brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    ),
    buildMs: Math.round(performance.now() - t0),
  };
}
writeFileSync(join(here, 'out', 's6-bundle.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
