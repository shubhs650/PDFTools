// CRS project templates on this device (M13-07, D-71, plan M13 §6; C13, C14):
// read once from IndexedDB and kept current here; imported from a workbook or
// a template file, edited, duplicated, renamed and deleted; the template last
// used for an export is remembered. "Clear all local data" removes them. A
// template's workbook and settings never leave the device except in a
// template file the person exports, and nothing here is logged (rule 10:
// errors go to diagnostics as codes only). The workbook is only read in the
// Work worker (rule 1).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { t } from '../../../i18n';
import {
  defaultSettings,
  MAX_NAME,
  settingsPart,
  STATUS_WORDS,
  templatesOf,
  uniqueName,
  type CrsTemplate,
  type CrsTemplateSettings,
  type StatusWord,
} from '../../../model/crs/template';
import { appDb } from '../../../storage/appDb';
import type { TemplateInspection, TemplateProbe } from '../../../workers/work/crsTemplate/inspect';
import { workClient } from '../../view/host';
import { STATUS_KEYS } from '../../annotate/comments/statusLabels';

/** The Standard CRS in the template drop-down (the built-in layout, D-15). */
export const STANDARD_TEMPLATE = '';

/** Where the last used template's id is kept (settings store). */
export const LAST_TEMPLATE_KEY = 'crs.lastTemplate';

interface CrsTemplateState {
  templates: CrsTemplate[];
  loaded: boolean;
  /** The template last used for an export; STANDARD_TEMPLATE for the Standard CRS. */
  lastUsed: string;
}

export const crsTemplateStore = createStore<CrsTemplateState>()(() => ({
  templates: [],
  loaded: false,
  lastUsed: STANDARD_TEMPLATE,
}));

export function useCrsTemplates<T>(pick: (s: CrsTemplateState) => T): T {
  return useStore(crsTemplateStore, pick);
}

/** The app's own status words (C7: a template starts with them). */
export function appStatusWords(): Record<StatusWord, string> {
  const keys: Record<StatusWord, (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS]> = {
    accepted: STATUS_KEYS.Accepted,
    rejected: STATUS_KEYS.Rejected,
    cancelled: STATUS_KEYS.Cancelled,
    completed: STATUS_KEYS.Completed,
    none: STATUS_KEYS.none,
  };
  // No status writes an empty cell, as the Standard CRS does.
  return Object.fromEntries(STATUS_WORDS.map((w) => [w, w === 'none' ? '' : t(keys[w])])) as Record<
    StatusWord,
    string
  >;
}

export async function loadCrsTemplates(): Promise<void> {
  try {
    const db = await appDb();
    const [list, last] = await Promise.all([
      db.listCrsTemplates(),
      db.getSetting<unknown>(LAST_TEMPLATE_KEY),
    ]);
    const templates = templatesOf(list, appStatusWords());
    const lastUsed =
      typeof last === 'string' && templates.some((x) => x.id === last) ? last : STANDARD_TEMPLATE;
    crsTemplateStore.setState({ templates, loaded: true, lastUsed });
  } catch (err) {
    recordError('crs.templates', err);
    crsTemplateStore.setState({ loaded: true });
  }
}

async function ensureLoaded(): Promise<void> {
  if (!crsTemplateStore.getState().loaded) await loadCrsTemplates();
}

/** After "Clear all local data": none, read again when next needed. */
export function resetCrsTemplates(): void {
  crsTemplateStore.setState({ templates: [], loaded: false, lastUsed: STANDARD_TEMPLATE });
}

let seq = 0;
const newId = (): string => `crs-${Date.now().toString(36)}-${String(++seq)}`;

const byName = (list: CrsTemplate[]): CrsTemplate[] =>
  [...list].sort((a, b) => a.name.localeCompare(b.name) || a.created - b.created);

async function put(tpl: CrsTemplate): Promise<void> {
  const db = await appDb();
  await db.putCrsTemplate(tpl);
  crsTemplateStore.setState((s) => ({
    templates: byName([...s.templates.filter((x) => x.id !== tpl.id), tpl]),
  }));
}

export function templateById(id: string): CrsTemplate | undefined {
  return crsTemplateStore.getState().templates.find((x) => x.id === id);
}

/** Checks a picked workbook in the Work worker (kind, load, sheets, lost parts; C3 with a probe). */
export function inspectWorkbook(
  bytes: ArrayBuffer,
  probe: TemplateProbe | null = null,
  signal?: AbortSignal,
): Promise<TemplateInspection> {
  return workClient().run(
    'crsTemplateInspect',
    { bytes: bytes.slice(0), probe },
    signal ? { signal } : {},
  ).promise;
}

/**
 * Saves a new template from an imported workbook (C13: the guided steps then
 * edit its settings). The name is made unique; the file name is the picked
 * file's, shown in the manager.
 */
export async function addCrsTemplate(input: {
  name: string;
  fileName: string;
  kind: 'xlsx' | 'xltx';
  workbook: ArrayBuffer;
  settings?: CrsTemplateSettings;
  sheet: string;
  startRow: number;
}): Promise<CrsTemplate> {
  await ensureLoaded();
  const now = Date.now();
  const taken = crsTemplateStore.getState().templates.map((x) => x.name);
  const tpl: CrsTemplate = {
    ...(input.settings ?? defaultSettings(input.sheet, input.startRow, appStatusWords())),
    id: newId(),
    name: uniqueName(input.name, taken),
    fileName: input.fileName,
    kind: input.kind,
    workbook: input.workbook,
    created: now,
    modified: now,
  };
  await put(tpl);
  return tpl;
}

/** Saves new settings for a template (the set-up and the manager's Edit). */
export async function updateCrsTemplate(id: string, settings: CrsTemplateSettings): Promise<void> {
  await ensureLoaded();
  const cur = templateById(id);
  if (!cur) return;
  await put({ ...cur, ...settingsPart(settings), modified: Date.now() });
}

export async function renameCrsTemplate(id: string, name: string): Promise<void> {
  await ensureLoaded();
  const cur = templateById(id);
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!cur || !trimmed || trimmed === cur.name) return;
  const taken = crsTemplateStore
    .getState()
    .templates.filter((x) => x.id !== id)
    .map((x) => x.name);
  await put({ ...cur, name: uniqueName(trimmed, taken), modified: Date.now() });
}

/** A copy under a new name ("Project CRS (2)"). */
export async function duplicateCrsTemplate(id: string): Promise<CrsTemplate | null> {
  await ensureLoaded();
  const cur = templateById(id);
  if (!cur) return null;
  const now = Date.now();
  const taken = crsTemplateStore.getState().templates.map((x) => x.name);
  const copy: CrsTemplate = {
    ...cur,
    ...settingsPart(cur),
    id: newId(),
    name: uniqueName(cur.name, taken),
    workbook: cur.workbook.slice(0),
    created: now,
    modified: now,
  };
  await put(copy);
  return copy;
}

export async function deleteCrsTemplate(id: string): Promise<void> {
  await ensureLoaded();
  const db = await appDb();
  await db.deleteCrsTemplate(id);
  crsTemplateStore.setState((s) => ({
    templates: s.templates.filter((x) => x.id !== id),
    lastUsed: s.lastUsed === id ? STANDARD_TEMPLATE : s.lastUsed,
  }));
  if (crsTemplateStore.getState().lastUsed === STANDARD_TEMPLATE)
    await db.setSetting(LAST_TEMPLATE_KEY, STANDARD_TEMPLATE);
}

/** Remembers the template an export used (the drop-down selects it next time). */
export async function setLastCrsTemplate(id: string): Promise<void> {
  crsTemplateStore.setState({ lastUsed: id });
  try {
    await (await appDb()).setSetting(LAST_TEMPLATE_KEY, id);
  } catch (err) {
    recordError('crs.templates', err);
  }
}

/** C14: the template file's bytes (built in the Work worker) and a suggested name. */
export async function exportTemplateFile(
  id: string,
): Promise<{ name: string; bytes: ArrayBuffer } | null> {
  const cur = templateById(id);
  if (!cur) return null;
  const { bytes } = await workClient().run('crsTemplateFileWrite', {
    template: {
      ...settingsPart(cur),
      name: cur.name,
      fileName: cur.fileName,
      kind: cur.kind,
      workbook: cur.workbook.slice(0),
    },
  }).promise;
  return { name: t('crs.tpl.fileName', { name: cur.name }), bytes };
}

/** C14: imports a template file; the new template, or why it was refused. */
export async function importTemplateFile(
  bytes: ArrayBuffer,
): Promise<
  { ok: true; template: CrsTemplate } | { ok: false; reason: 'not-template' | 'newer' | 'damaged' }
> {
  const read = await workClient().run('crsTemplateFileRead', {
    bytes: bytes.slice(0),
    appStatus: appStatusWords(),
  }).promise;
  if (!read.ok) return read;
  const { name, fileName, kind, workbook, ...settings } = read.template;
  const template = await addCrsTemplate({
    name,
    fileName,
    kind,
    workbook,
    settings,
    sheet: settings.sheet,
    startRow: settings.startRow,
  });
  return { ok: true, template };
}
