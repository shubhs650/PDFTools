// The CRS template file (M13-07, D-71, C14): one JSON file holding the
// workbook (base64) and the settings, so a colleague who imports it gets the
// same set-up. Versioned: a file from a newer major version is refused with a
// plain message; unknown keys are ignored. No new dependency. Pure; run in the
// Work worker for the base64 work (rule 1).
import { fromBase64, toBase64 } from '../base64';
import {
  MAX_NAME,
  settingsOf,
  settingsPart,
  type CrsTemplate,
  type CrsTemplateSettings,
  type StatusWord,
  type WorkbookKind,
} from './template';

export const TEMPLATE_FORMAT = 'triya-crs-template';
export const TEMPLATE_VERSION = 1;

/** What a template file brings: everything but the id and the dates. */
export interface TemplateFileContent extends CrsTemplateSettings {
  name: string;
  fileName: string;
  kind: WorkbookKind;
  workbook: ArrayBuffer;
}

export type TemplateFileRead =
  | { ok: true; template: TemplateFileContent }
  | { ok: false; reason: 'not-template' | 'newer' | 'damaged' };

/** The file's text for `t`. */
export function writeTemplateFile(
  t: Pick<CrsTemplate, 'name' | 'fileName' | 'kind' | 'workbook'> & CrsTemplateSettings,
): string {
  return JSON.stringify({
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    name: t.name,
    fileName: t.fileName,
    kind: t.kind,
    settings: settingsPart(t),
    workbook: toBase64(new Uint8Array(t.workbook)),
  });
}

/** Reads a template file's text; the workbook's kind is checked by the caller. */
export function readTemplateFile(
  text: string,
  appStatus: Record<StatusWord, string>,
): TemplateFileRead {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-template' };
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return { ok: false, reason: 'not-template' };
  }
  const o = v as Partial<
    Record<'format' | 'version' | 'name' | 'fileName' | 'kind' | 'settings' | 'workbook', unknown>
  >;
  if (o.format !== TEMPLATE_FORMAT) return { ok: false, reason: 'not-template' };
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) {
    return { ok: false, reason: 'damaged' };
  }
  if (o.version > TEMPLATE_VERSION) return { ok: false, reason: 'newer' };
  const settings = settingsOf(o.settings, appStatus);
  const bytes = typeof o.workbook === 'string' ? fromBase64(o.workbook) : null;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, MAX_NAME) : '';
  if (!settings || !bytes || bytes.length === 0 || !name) return { ok: false, reason: 'damaged' };
  return {
    ok: true,
    template: {
      ...settings,
      name,
      fileName: typeof o.fileName === 'string' ? o.fileName.slice(0, 260) : '',
      kind: o.kind === 'xltx' ? 'xltx' : 'xlsx',
      workbook: bytes.slice().buffer,
    },
  };
}
