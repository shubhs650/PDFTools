// The vendored font library's manifest (M11-07, D-52): vendor/fonts/manifest.json,
// written by scripts/fonts/build.ts and read by the license check, the
// third-party notices and the Vite asset plugin.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_LIBRARY, libraryFiles } from '../../src/model/fonts/library.ts';

export const VENDOR_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'vendor',
  'fonts',
);
export const FONT_MANIFEST = join(VENDOR_DIR, 'manifest.json');

export interface FontManifest {
  /** When the upstream files were taken (they are pinned by SHA-256 in sources.ts). */
  snapshot: string;
  /** By library family id. */
  families: Record<
    string,
    { name: string; version: string; license: string; source: string; reservedName?: string }
  >;
  /** By shipped file name (vendor/fonts/files/). */
  files: Record<string, { sha256: string; bytes: number }>;
}

export function readFontManifest(): FontManifest {
  return JSON.parse(readFileSync(FONT_MANIFEST, 'utf8')) as FontManifest;
}

export const fontFile = (file: string): string => join(VENDOR_DIR, 'files', file);
export const fontLicense = (id: string): string => join(VENDOR_DIR, 'licenses', `${id}.txt`);

/**
 * What is wrong with vendor/fonts/ (empty when nothing): every file the
 * catalogue names is there with the manifest's SHA-256, every family has its
 * license text and an entry with a license.
 */
export function verifyVendoredFonts(manifest: FontManifest = readFontManifest()): string[] {
  const problems: string[] = [];
  const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
  for (const file of libraryFiles()) {
    const entry = manifest.files[file];
    const path = fontFile(file);
    if (!entry) problems.push(`${file}: not in manifest.json`);
    else if (!existsSync(path)) problems.push(`${file}: missing`);
    else if (sha(readFileSync(path)) !== entry.sha256) problems.push(`${file}: SHA-256 differs`);
  }
  for (const fam of FONT_LIBRARY) {
    if (!manifest.families[fam.id]?.license)
      problems.push(`${fam.id}: no license in manifest.json`);
    if (!existsSync(fontLicense(fam.id))) problems.push(`${fam.id}: license text missing`);
  }
  return problems;
}
