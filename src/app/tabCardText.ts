// What a file tab's hover card says about its document (M11-03, ADR-028 D-50): where
// the file came from (a web app never learns its folder), pages, size and last-modified
// time, and status chips. Pure: the strings come from `t` and the numbers from the
// `Intl` formatters, so the card and the tab's accessible description say the same.
import type { TFunction } from 'i18next';
import { msg, type MessageKey } from '../i18n';
import type { Formatters } from '../i18n/format';
import { restrictions } from '../model/permissions';
import { securityOf, type DocumentSlice, type DocumentSource } from './store/documentStore';

const SOURCE: Readonly<Record<DocumentSource, MessageKey>> = {
  picked: msg('tabCard.source.picked'),
  dropped: msg('tabCard.source.dropped'),
  launched: msg('tabCard.source.launched'),
  recent: msg('tabCard.source.recent'),
  recovered: msg('tabCard.source.recovered'),
  attachment: msg('tabCard.source.attachment'),
  created: msg('tabCard.source.created'),
  saved: msg('tabCard.source.saved'),
  downloaded: msg('tabCard.source.downloaded'),
};

export type TabStatus = 'unsaved' | 'protected' | 'restricted' | 'signed';

const STATUS: Readonly<Record<TabStatus, MessageKey>> = {
  unsaved: msg('tabCard.status.unsaved'),
  protected: msg('tabCard.status.protected'),
  restricted: msg('tabCard.status.restricted'),
  signed: msg('tabCard.status.signed'),
};

/** The chips, in display order: unsaved first, it is the one that needs action. */
export function tabStatus(d: DocumentSlice): TabStatus[] {
  const sec = securityOf(d.meta);
  const out: TabStatus[] = [];
  if (d.dirty) out.push('unsaved');
  if (sec.revision >= 2) out.push('protected');
  if (restrictions(sec).length > 0) out.push('restricted');
  if (d.meta.signatureCount > 0) out.push('signed');
  return out;
}

export interface TabCardText {
  /** The full file name, never cut. */
  name: string;
  source: string;
  /** "3 pages · 1.4 MB · modified 12 Nov 2026, 10:42"; size and time only for a file. */
  details: string;
  status: { id: TabStatus; label: string }[];
  /** All of the above but the name (the tab's name already is it), for screen readers. */
  description: string;
}

export function tabCardText(d: DocumentSlice, t: TFunction, format: Formatters): TabCardText {
  const { meta } = d;
  const source = t(SOURCE[meta.source ?? 'picked']);
  const facts = [t('tabCard.pages', { count: meta.pageCount })];
  if (meta.fileSize !== undefined) facts.push(format.bytes(meta.fileSize));
  if (meta.modified !== undefined)
    facts.push(t('tabCard.modified', { date: format.dateTime(meta.modified) }));
  const details = facts.join(t('tabCard.separator'));
  const status = tabStatus(d).map((id) => ({ id, label: t(STATUS[id]) }));
  const description = [source, details, ...status.map((s) => s.label)].join(t('tabCard.sentence'));
  return { name: meta.name, source, details, status, description };
}
