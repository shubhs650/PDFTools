// Third-party notices (M1-26, §10.3, D-12, ADR-002): one text file listing
// every installed runtime package (npm's lockfile: not dev, not devOptional)
// with its license text. Texts come from the package's own LICENSE / COPYING /
// NOTICE files (so PDFium's LICENSE.pdfium and the fonts' OFL-1.1 text are
// included); a package that ships none gets the standard text of a short
// permissive license with the copyright holder from its manifest. A package
// with neither fails the generator, so a new dependency cannot slip through.
//
// Used by the Vite build (third-party-notices.txt next to index.html) and by
// `npm run licenses -- --notices <file>`.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { licenseFromManifest, parseSpdx, type SpdxNode } from './license-policy.ts';

export const NOTICES_FILE = 'third-party-notices.txt';

export interface NoticeText {
  /** File name inside the package, or `standard <SPDX id> text`. */
  source: string;
  text: string;
}

export interface NoticePackage {
  name: string;
  version: string;
  license: string;
  homepage?: string;
  texts: NoticeText[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.\-_][\w.-]*)?$/i;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** Lockfile paths of installed runtime packages (conservative: only `dev`/`devOptional` are excluded). */
export function runtimePaths(lock: {
  packages?: Record<string, { dev?: boolean; devOptional?: boolean }>;
}): string[] {
  return Object.entries(lock.packages ?? {})
    .filter(([path, meta]) => path !== '' && meta.dev !== true && meta.devOptional !== true)
    .map(([path]) => path)
    .sort();
}

function holder(manifest: Record<string, unknown>, name: string): string {
  const author = manifest.author;
  if (typeof author === 'string' && author.trim()) return author.trim();
  if (author && typeof author === 'object') {
    const n = (author as Record<string, unknown>).name;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return `the ${name} authors`;
}

const TEMPLATES: Record<string, (who: string) => string> = {
  MIT: (who) => `MIT License

Copyright (c) ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  ISC: (who) => `ISC License

Copyright (c) ${who}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`,
  '0BSD': () => `Zero-Clause BSD

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`,
};

/** SPDX ids in an expression, in order (for `A OR B` the first one with a template wins). */
function ids(node: SpdxNode): string[] {
  if (node.type === 'license') return [node.id];
  return [...ids(node.left), ...ids(node.right)];
}

/** The standard text for a package without license files, or undefined if none applies. */
export function standardText(
  license: string,
  manifest: Record<string, unknown>,
  name: string,
): NoticeText | undefined {
  let list: string[];
  try {
    list = ids(parseSpdx(license));
  } catch {
    return undefined;
  }
  // `AND` needs every part; only the single-license and `OR` cases are templated.
  if (/\bAND\b/i.test(license)) return undefined;
  for (const id of list) {
    const make = TEMPLATES[id.toUpperCase() === 'MIT' ? 'MIT' : id];
    if (make) return { source: `standard ${id} text`, text: make(holder(manifest, name)) };
  }
  return undefined;
}

export function licenseTexts(dir: string): NoticeText[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((source) => ({ source, text: readFileSync(join(dir, source), 'utf8') }));
}

function homepage(manifest: Record<string, unknown>): string | undefined {
  if (typeof manifest.homepage === 'string') return manifest.homepage;
  const repo = manifest.repository;
  const url =
    typeof repo === 'string'
      ? repo
      : repo && typeof repo === 'object'
        ? (repo as Record<string, unknown>).url
        : undefined;
  return typeof url === 'string' ? url.replace(/^git\+/, '').replace(/\.git$/, '') : undefined;
}

/** Every installed runtime package with its license texts; throws if one has none. */
export function collectNotices(root: string): NoticePackage[] {
  const lock = readJson(join(root, 'package-lock.json'));
  const seen = new Map<string, NoticePackage>();
  const missing: string[] = [];
  for (const path of runtimePaths(lock)) {
    const dir = join(root, path);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue; // optional, not installed on this platform
    const manifest = readJson(manifestPath);
    const name = typeof manifest.name === 'string' ? manifest.name : path;
    const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    const license = licenseFromManifest(manifest) ?? 'UNKNOWN';
    let texts = licenseTexts(dir);
    if (texts.length === 0) {
      const std = standardText(license, manifest, name);
      if (std) texts = [std];
      else missing.push(`${key} (${license})`);
    }
    const home = homepage(manifest);
    seen.set(key, { name, version, license, ...(home ? { homepage: home } : {}), texts });
  }
  if (missing.length) {
    throw new Error(`No license text for: ${missing.join(', ')}`);
  }
  return [...seen.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

const RULE = '-'.repeat(78);

/** The notices file. Identical texts are printed once and referenced afterwards. */
export function renderNotices(pkgs: readonly NoticePackage[], app = 'PDFTools'): string {
  const out: string[] = [
    `${app} — third-party notices`,
    '',
    `${app} includes the following ${String(pkgs.length)} open-source packages.`,
    'Each is listed with its license and the license text it is distributed under.',
    '',
  ];
  const printed = new Map<string, string>();
  for (const p of pkgs) {
    out.push(RULE, `${p.name} ${p.version}`, `License: ${p.license}`);
    if (p.homepage) out.push(`Source: ${p.homepage}`);
    for (const t of p.texts) {
      const text = t.text.replace(/\r\n/g, '\n').trimEnd();
      const first = printed.get(text);
      out.push('');
      if (first) {
        out.push(`${t.source}: same text as ${first}.`);
      } else {
        printed.set(text, `${p.name} ${p.version} (${t.source})`);
        out.push(`${t.source}:`, '', text);
      }
    }
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
