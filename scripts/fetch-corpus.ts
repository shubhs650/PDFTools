// Downloads the public test corpus listed in corpus/manifest.json into
// corpus/files/ (git-ignored). Verifies sha256 when the manifest has one and
// prints it when it does not, so it can be recorded (ARCHITECTURE §11).
//
// Usage: node scripts/fetch-corpus.ts [name ...]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Entry {
  name: string;
  url: string;
  sha256: string | null;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'corpus/manifest.json'), 'utf8')) as {
  files: Entry[];
};
const wanted = process.argv.slice(2);
const outDir = join(root, 'corpus/files');
mkdirSync(outDir, { recursive: true });

let failed = false;
for (const f of manifest.files) {
  if (wanted.length > 0 && !wanted.includes(f.name)) continue;
  const target = join(outDir, f.name);
  let bytes: Buffer;
  if (existsSync(target)) {
    bytes = readFileSync(target);
    console.log(`${f.name}: already present`);
  } else {
    console.log(`${f.name}: downloading ${f.url}`);
    const res = await fetch(f.url);
    if (!res.ok) {
      console.error(`${f.name}: HTTP ${String(res.status)}`);
      failed = true;
      continue;
    }
    bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(target, bytes);
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (f.sha256 === null) {
    console.log(`${f.name}: sha256 ${sha} (not yet recorded in corpus/manifest.json)`);
  } else if (f.sha256 !== sha) {
    console.error(`${f.name}: sha256 mismatch (expected ${f.sha256}, got ${sha})`);
    failed = true;
  } else {
    console.log(`${f.name}: sha256 ok (${String(bytes.length)} bytes)`);
  }
}
process.exit(failed ? 1 : 0);
