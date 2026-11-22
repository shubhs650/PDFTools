// The one loader every test uses for the comparison corpus (M12-01, D-66).
// It reads the two manifests in `Synthetic PDF Corpus/` and returns file
// paths or bytes. Large speed files (atTestTime in the catalog) are not in the
// repository: they are built on first use and written to the OS temp folder.

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_PAIRS, type CorpusKind } from './catalog.ts';

export type { CorpusKind } from './catalog.ts';

export const CORPUS_ROOT = fileURLToPath(
  new URL('../../../Synthetic PDF Corpus/', import.meta.url),
);

const DIRS: Record<CorpusKind, { dir: string; manifest: string }> = {
  overlay: { dir: 'engineering_pdf_overlay_test_corpus', manifest: 'CORPUS_MANIFEST.csv' },
  text: { dir: 'text_comparison_pdf_corpus', manifest: 'TEXT_CORPUS_MANIFEST.csv' },
};

export interface CorpusPair {
  kind: CorpusKind;
  /** Two digits, as in the manifest ("07"). */
  id: string;
  /** Discipline (overlay) or document type (text). */
  type: string;
  oldFile: string;
  newFile: string;
  oldPages: number;
  newPages: number;
  /** Sheet size (overlay) or layout (text). */
  layout: string;
  edgeCase: string;
  expected: string;
  /** Built on first use instead of read from the repository. */
  atTestTime: boolean;
}

/** Passwords of the encrypted corpus files (overlay pair 12; see its README). */
export const CORPUS_PASSWORDS: Record<string, { user: string; owner: string }> = {
  '12_encrypted_bridge_pier_RevA_OLD.pdf': { user: '', owner: 'overlay_owner_2026' },
  '12_encrypted_bridge_pier_RevB_NEW.pdf': { user: 'test1234', owner: 'overlay_owner_2026' },
};

/** RFC 4180 CSV: quoted fields, doubled quotes, commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

export function manifestPath(kind: CorpusKind): string {
  return join(CORPUS_ROOT, DIRS[kind].dir, DIRS[kind].manifest);
}

/** Every pair in the manifest of one kind, or of both. */
export function corpusPairs(kind?: CorpusKind): CorpusPair[] {
  if (!kind) return [...corpusPairs('overlay'), ...corpusPairs('text')];
  const rows = parseCsv(readFileSync(manifestPath(kind), 'utf8')).slice(1);
  return rows.map((r) => {
    const [
      id = '',
      type = '',
      oldFile = '',
      newFile = '',
      op = '0',
      np = '0',
      layout = '',
      edgeCase = '',
      expected = '',
    ] = r;
    return {
      kind,
      id,
      type,
      oldFile,
      newFile,
      oldPages: Number(op),
      newPages: Number(np),
      layout,
      edgeCase,
      expected,
      atTestTime: GENERATED_PAIRS.some((g) => g.kind === kind && g.id === id && g.atTestTime),
    };
  });
}

export function corpusPair(kind: CorpusKind, id: string): CorpusPair {
  const pair = corpusPairs(kind).find((p) => p.id === id.padStart(2, '0'));
  if (!pair) throw new Error(`no ${kind} corpus pair ${id}`);
  return pair;
}

/** The pair's folder in the repository: the one whose name starts with pair_<id>_. */
function pairFolder(pair: CorpusPair): string {
  const base = join(CORPUS_ROOT, DIRS[pair.kind].dir);
  const hit = readdirSync(base).find((d) => d.startsWith(`pair_${pair.id}_`));
  if (!hit) throw new Error(`no folder for ${pair.kind} corpus pair ${pair.id}`);
  return join(base, hit);
}

const built = new Map<string, { old: string; new: string }>();

/** Builds an at-test-time pair once per process and writes it to the temp folder. */
function buildAtTestTime(pair: CorpusPair): { old: string; new: string } {
  const key = `${pair.kind}-${pair.id}`;
  const hit = built.get(key);
  if (hit) return hit;
  const gen = GENERATED_PAIRS.find((g) => g.kind === pair.kind && g.id === pair.id);
  if (!gen) throw new Error(`no generator for ${key}`);
  const files = gen.build();
  const dir = join(tmpdir(), 'triya-pdf-corpus', DIRS[pair.kind].dir, gen.folder);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, bytes: Uint8Array): string => {
    const path = join(dir, name);
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
    return path;
  };
  const out = { old: write(gen.oldFile, files.old), new: write(gen.newFile, files.new) };
  built.set(key, out);
  return out;
}

/** The path of one side of a pair (Rev A = old, Rev B = new). */
export function corpusFile(pair: CorpusPair, side: 'old' | 'new'): string {
  if (pair.atTestTime) return buildAtTestTime(pair)[side];
  return join(pairFolder(pair), side === 'old' ? pair.oldFile : pair.newFile);
}

export function corpusBytes(pair: CorpusPair, side: 'old' | 'new'): Uint8Array {
  return new Uint8Array(readFileSync(corpusFile(pair, side)));
}

/** The page count from the root page tree (/Type /Pages … /Count n): enough for the corpus files. */
export function pageCount(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1');
  const counts = [
    ...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g),
    ...text.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g),
  ].map((m) => Number(m[1]));
  if (!counts.length) throw new Error('no page tree found');
  return Math.max(...counts);
}
