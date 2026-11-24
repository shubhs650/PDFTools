// The CRS template screens' state (M13-08, D-71, plan M13 §6 "Setting up",
// C13, C14): the template manager (from the export dialog and Settings), and
// the guided set-up of one template — a fresh import or an edit. Picked
// files are checked in the Work worker (rule 1); their names and contents are
// never logged or reported (rule 10).
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { t } from '../../../i18n';
import {
  defaultSettings,
  settingsPart,
  type CrsTemplateSettings,
  type WorkbookKind,
} from '../../../model/crs/template';
import type { TemplateSheetInfo } from '../../../workers/work/crsTemplate/inspect';
import type { LostPart, WorkbookFileKind } from '../../../workers/work/crsTemplate/kind';
import {
  addCrsTemplate,
  appStatusWords,
  inspectWorkbook,
  loadCrsTemplates,
  renameCrsTemplate,
  templateById,
  updateCrsTemplate,
} from './crsTemplateStore';

/** Why a picked workbook was refused (the import's message). */
export type RefusedKind = Exclude<WorkbookFileKind, 'xlsx' | 'xltx'> | 'unreadable';

/** One set-up in progress: a fresh import (id null) or an edit. */
export interface SetupSession {
  id: string | null;
  name: string;
  fileName: string;
  kind: WorkbookKind;
  workbook: ArrayBuffer;
  /** Names the workbook for the Work worker's kept copy (the preview). */
  key: string;
  sheets: TemplateSheetInfo[];
  lost: LostPart[];
  settings: CrsTemplateSettings;
}

interface TemplateUiState {
  manager: boolean;
  setup: SetupSession | null;
  /** The template the last set-up saved (the export dialog selects it). */
  saved: string | null;
  /** Busy reading a picked file. */
  busy: boolean;
}

export const templateUi = createStore<TemplateUiState>()(() => ({
  manager: false,
  setup: null,
  saved: null,
  busy: false,
}));

export function useTemplateUi<T>(pick: (s: TemplateUiState) => T): T {
  return useStore(templateUi, pick);
}

let seq = 0;
const newKey = (): string => `crs-setup-${Date.now().toString(36)}-${String(++seq)}`;

export function openTemplateManager(): void {
  void loadCrsTemplates();
  templateUi.setState({ manager: true });
}

export function closeTemplateManager(): void {
  templateUi.setState({ manager: false });
}

/** "Project CRS.xlsx" → "Project CRS". */
const baseName = (fileName: string): string =>
  fileName.replace(/\.(xlsx|xltx|xlsm|xltm|xlsb|xls)$/iu, '').trim() || t('crs.tpl.newName');

/** The sheet a fresh import starts on: one that sounds like a CRS, else the first shown. */
export function firstSheet(sheets: readonly TemplateSheetInfo[]): string {
  const shown = sheets.filter((s) => s.state === 'visible');
  const list = shown.length ? shown : sheets;
  return (
    list.find((s) => /crs|comment|review|resolution/iu.test(s.name))?.name ?? list[0]?.name ?? ''
  );
}

/**
 * Checks a picked workbook and opens the guided set-up on it. Resolves to
 * null when it opened, or to why the workbook was refused.
 */
export async function importWorkbook(file: File): Promise<RefusedKind | null> {
  templateUi.setState({ busy: true });
  try {
    const bytes = await file.arrayBuffer();
    const check = await inspectWorkbook(bytes);
    if (!check.ok) return check.kind as RefusedKind;
    const sheet = firstSheet(check.sheets);
    templateUi.setState({
      setup: {
        id: null,
        name: baseName(file.name),
        fileName: file.name,
        kind: check.kind,
        workbook: bytes,
        key: newKey(),
        sheets: check.sheets,
        lost: check.lost,
        settings: defaultSettings(sheet, 0, appStatusWords()),
      },
    });
    return null;
  } catch (err) {
    recordError('crs.templateImport', err);
    return 'unreadable';
  } finally {
    templateUi.setState({ busy: false });
  }
}

/** Opens the guided set-up on a kept template (the manager's Edit). */
export async function editTemplate(id: string): Promise<boolean> {
  const tpl = templateById(id);
  if (!tpl) return false;
  templateUi.setState({ busy: true });
  try {
    const check = await inspectWorkbook(tpl.workbook);
    if (!check.ok) return false;
    templateUi.setState({
      setup: {
        id,
        name: tpl.name,
        fileName: tpl.fileName,
        kind: tpl.kind,
        workbook: tpl.workbook,
        key: newKey(),
        sheets: check.sheets,
        lost: check.lost,
        settings: settingsPart(tpl),
      },
    });
    return true;
  } catch (err) {
    recordError('crs.templateEdit', err);
    return false;
  } finally {
    templateUi.setState({ busy: false });
  }
}

export function cancelSetup(): void {
  templateUi.setState({ setup: null });
}

/** Saves the set-up: a new template from an import, or new settings and name for an edit. */
export async function saveSetup(name: string, settings: CrsTemplateSettings): Promise<string> {
  const s = templateUi.getState().setup;
  if (!s) return '';
  let id: string;
  if (s.id) {
    await updateCrsTemplate(s.id, settings);
    await renameCrsTemplate(s.id, name);
    id = s.id;
  } else {
    const tpl = await addCrsTemplate({
      name,
      fileName: s.fileName,
      kind: s.kind,
      workbook: s.workbook,
      settings,
      sheet: settings.sheet,
      startRow: settings.startRow,
    });
    id = tpl.id;
  }
  templateUi.setState({ setup: null, saved: id });
  return id;
}
