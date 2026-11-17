// Spike S26: downloads the library's source files from the Google Fonts
// repository into out/src/ (git-ignored) and checks each file's SHA-256
// against catalogue.ts. Build time only: the app never fetches fonts from
// Google (rule 4). Run: node spikes/s26-freetext-fonts/fetch-fonts.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAMILIES, SHA256 } from './catalogue.ts';

const OUT = join(import.meta.dirname, 'out', 'src');
mkdirSync(OUT, { recursive: true });
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

for (const fam of FAMILIES) {
  const files = new Set(Object.values(fam.faces).map((f) => f.file));
  const want = [...files, 'OFL.txt'];
  for (const file of want) {
    const local = join(OUT, file === 'OFL.txt' ? `${fam.id}-OFL.txt` : file);
    if (existsSync(local) && (file === 'OFL.txt' || sha(readFileSync(local)) === SHA256[file]))
      continue;
    const url = `${RAW}/${fam.dir}/${encodeURIComponent(file)}`;
    const res = await fetch(url);
    if (file === 'OFL.txt' && res.status === 404) {
      // Upstream gap (Tinos, 2026-11-17): the license is then read from the font's name table (IDs 13, 14).
      console.warn(`${fam.dir}: no OFL.txt upstream`);
      continue;
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (file !== 'OFL.txt' && sha(bytes) !== SHA256[file])
      throw new Error(`${file}: SHA-256 differs from catalogue.ts (upstream changed?)`);
    writeFileSync(local, bytes);
    console.log(`${file} ${String(bytes.length)}`);
  }
}
