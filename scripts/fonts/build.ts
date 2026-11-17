// Builds the font library for text comments (M11-07, D-52, ADR-028's S26
// amendment) into vendor/fonts/: the shipped faces under files/, each
// family's license under licenses/<id>.txt, and manifest.json (SHA-256 and
// size of every file, each family's version and license). The output is
// committed, so neither the app build nor CI ever downloads fonts.
//
//   node scripts/fonts/build.ts            download (pinned), cut and write
//   node scripts/fonts/build.ts --check    only verify vendor/fonts/ against manifest.json
//
// Sources: the Google Fonts repository (scripts/fonts/sources.ts, pinned by
// SHA-256), downloaded into node_modules/.cache/fonts-src/. Each face is
// pinned to one instance and cut to its scripts, keeping layout tables (it is
// shaped at runtime) and dropping hinting. A family whose license reserves its
// name ships the upstream files unmodified (only renamed).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hb from 'harfbuzzjs';
import { FONT_LIBRARY, type LibraryFamily } from '../../src/model/fonts/library.ts';
import { FLAG_NO_HINTING, Subsetter } from '../../src/workers/render/commentFonts/hbsubset.ts';
import { codepoints, rangesFor, SHA256, SOURCES } from './sources.ts';
import { FONT_MANIFEST, VENDOR_DIR, verifyVendoredFonts, type FontManifest } from './manifest.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const CACHE = join(root, 'node_modules', '.cache', 'fonts-src');
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
/** The date the pinned upstream files were taken (sources.ts). */
const SNAPSHOT = '2026-11-17';

async function fetchSource(dir: string, file: string): Promise<Uint8Array | null> {
  const local = join(CACHE, dir.replace(/\//g, '_'), file);
  if (existsSync(local)) {
    const b = new Uint8Array(readFileSync(local));
    if (file === 'OFL.txt' || sha(b) === SHA256[file]) return b;
  }
  const res = await fetch(`${RAW}/${dir}/${encodeURIComponent(file)}`);
  if (file === 'OFL.txt' && res.status === 404) return null;
  if (!res.ok) throw new Error(`${dir}/${file}: HTTP ${String(res.status)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (file !== 'OFL.txt' && sha(bytes) !== SHA256[file])
    throw new Error(`${file}: SHA-256 differs from scripts/fonts/sources.ts (upstream changed?)`);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, bytes);
  return bytes;
}

const nameOf = (bytes: Uint8Array, id: number): string =>
  new hb.Face(new hb.Blob(bytes.slice().buffer)).getName(id, 'en');

/** "Version 3.015; 2026" → "3.015". */
const versionOf = (bytes: Uint8Array): string => /(\d+\.\d+)/u.exec(nameOf(bytes, 5))?.[1] ?? '0.0';

/** The upstream file a face of `fam` ships as, under its shipped name. */
function shippedFrom(
  fam: LibraryFamily,
): Map<string, { file: string; pin?: Record<string, number> }> {
  const src = SOURCES[fam.id];
  if (!src) throw new Error(`${fam.id}: no source in scripts/fonts/sources.ts`);
  const out = new Map<string, { file: string; pin?: Record<string, number> }>();
  for (const [key, face] of Object.entries(fam.faces)) {
    const s = src.faces[key as keyof typeof src.faces];
    if (!s) throw new Error(`${fam.id} ${key}: no source face`);
    if (src.reserved) out.set(face.file, { file: s.file });
    else out.set(face.file, { file: s.file, ...(s.pin ? { pin: s.pin } : {}) });
  }
  return out;
}

async function build(): Promise<void> {
  const sub = await Subsetter.load(
    readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')),
  );
  rmSync(join(VENDOR_DIR, 'files'), { recursive: true, force: true });
  mkdirSync(join(VENDOR_DIR, 'files'), { recursive: true });
  mkdirSync(join(VENDOR_DIR, 'licenses'), { recursive: true });
  const manifest: FontManifest = { snapshot: SNAPSHOT, families: {}, files: {} };
  let oflBody: string | null = null;
  const missingLicense: { id: string; copyright: string }[] = [];
  for (const fam of FONT_LIBRARY) {
    const src = SOURCES[fam.id];
    if (!src) throw new Error(`${fam.id}: no source`);
    let version = '';
    for (const [out, from] of shippedFrom(fam)) {
      const bytes = await fetchSource(src.dir, from.file);
      if (!bytes) throw new Error(`${from.file}: not found`);
      version ||= versionOf(bytes);
      const shipped = src.reserved
        ? bytes
        : sub.subset(bytes, {
            unicodes: codepoints(rangesFor(src.scripts)),
            ...(from.pin ? { pin: from.pin } : { instance: true }),
            flags: FLAG_NO_HINTING,
            drop: ['DSIG', 'STAT', 'hdmx', 'LTSH', 'VDMX'],
          });
      if (!shipped) throw new Error(`${out}: subset failed`);
      writeFileSync(join(VENDOR_DIR, 'files', out), shipped);
      manifest.files[out] = { sha256: sha(shipped), bytes: shipped.length };
    }
    const ofl = await fetchSource(src.dir, 'OFL.txt');
    const firstFile = Object.values(src.faces)[0]?.file ?? '';
    if (ofl) {
      const text = new TextDecoder().decode(ofl).replace(/\r\n/g, '\n');
      writeFileSync(join(VENDOR_DIR, 'licenses', `${fam.id}.txt`), text);
      // The license body without the copyright lines, for a family that has none upstream.
      oflBody ??= text.slice(text.indexOf('This Font Software is licensed'));
    } else {
      // Upstream gap (Tinos, 2026-11-17): the copyright from the font's name table.
      const bytes = await fetchSource(src.dir, firstFile);
      missingLicense.push({ id: fam.id, copyright: bytes ? nameOf(bytes, 0) : '' });
    }
    manifest.families[fam.id] = {
      name: fam.name,
      version,
      license: 'OFL-1.1',
      source: `https://github.com/google/fonts/tree/main/${src.dir}`,
      ...(src.reserved ? { reservedName: src.reserved } : {}),
    };
  }
  for (const m of missingLicense) {
    if (!oflBody || !m.copyright) throw new Error(`${m.id}: no license text`);
    writeFileSync(join(VENDOR_DIR, 'licenses', `${m.id}.txt`), `${m.copyright}\n\n${oflBody}`);
  }
  writeFileSync(FONT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const total = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0);
  console.log(
    `${String(Object.keys(manifest.files).length)} files, ${(total / 1048576).toFixed(2)} MB → ${VENDOR_DIR}`,
  );
}

if (process.argv.includes('--check')) {
  const problems = verifyVendoredFonts();
  for (const p of problems) console.error(`✖ ${p}`);
  if (problems.length) process.exit(1);
  console.log('✔ vendor/fonts matches manifest.json');
} else {
  await build();
  const problems = verifyVendoredFonts();
  if (problems.length) throw new Error(problems.join('\n'));
}
