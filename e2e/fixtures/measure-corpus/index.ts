// The measure corpus loader (M14-01, D-79): the manifest of true values and
// the sheets' paths and bytes. Every measuring e2e test reads its drawings here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item, SheetFile } from './sheets.ts';

export type { Item, ItemKind, UserPt } from './sheets.ts';

export const MEASURE_DIR = fileURLToPath(
  new URL('../../../Synthetic PDF Corpus/measure/', import.meta.url),
);

export interface ManifestSheet extends Omit<SheetFile, 'bytes' | 'items'> {
  /** Items; a value of null means "no value" (a measurement that spans two scales). */
  items: (Omit<Item, 'value'> & { value: number | null })[];
}

export interface MeasureManifest {
  version: 1;
  generator: string;
  sheets: ManifestSheet[];
}

/** The manifest written next to the sheets (NaN values become null). */
export function manifestOf(sheets: readonly SheetFile[]): MeasureManifest {
  return {
    version: 1,
    generator: 'e2e/fixtures/measure-corpus (M14-01)',
    sheets: sheets.map((s) => ({
      file: s.file,
      title: s.title,
      width: s.width,
      height: s.height,
      rotate: s.rotate,
      viewports: s.viewports,
      scaleNote: s.scaleNote,
      items: s.items.map((i) => ({ ...i, value: Number.isNaN(i.value) ? null : i.value })),
    })),
  };
}

export function measureManifest(): MeasureManifest {
  return JSON.parse(
    readFileSync(join(MEASURE_DIR, 'MEASURE_MANIFEST.json'), 'utf8'),
  ) as MeasureManifest;
}

export function measureSheetPath(file: string): string {
  return join(MEASURE_DIR, file);
}

export function measureSheetBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(measureSheetPath(file)));
}
