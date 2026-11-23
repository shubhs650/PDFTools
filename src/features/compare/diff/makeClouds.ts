// Make cloud comments (M12-14, D-61, Q17): the differences asked for become
// real cloud comments (a polygon with a cloudy border, the Cloud tool's own
// style) on the new revision, Document B, never automatically. Each is an
// ordinary comment: it is undone, edited, saved and exported like one drawn
// by hand (rule 6). Commenting needs B's commenting permission (rule 9).
import { expandRect, PdfAnnotationSubtype, rectFromPoints, uuidV4 } from '@embedpdf/models';
import type { PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { recordError } from '../../../app/diagnostics';
import { msg, t, type MessageKey } from '../../../i18n';
import { allows } from '../../../model/permissions';
import { cloudVertices } from '../../../model/compare/detect/clouds';
import type { DiffEntry } from '../../../model/compare/detect/entries';
import { capability, hostStore } from '../../view/host';
import type { Sheet } from '../overlay/overlayState';
import type { ShownEntry } from './diffState';

/** The Cloud tool's border reach (EmbedPDF: 4 × intensity + half the line, plus half the line). */
const cloudPad = (intensity: number, width: number): number => 4 * intensity + width;

export type CloudResult = { made: number; docs: string[] } | { blocked: string };

const KIND: Record<DiffEntry['kind'], MessageKey> = {
  added: msg('compare.diff.kind_added'),
  removed: msg('compare.diff.kind_removed'),
  changed: msg('compare.diff.kind_changed'),
};

/** What a cloud's note says: the kind of difference and its words. */
export function cloudText(e: DiffEntry): string {
  const kind = t(KIND[e.kind]);
  if (e.old && e.new) return t('compare.diff.cloudTextChange', { kind, old: e.old, new: e.new });
  if (e.old || e.new) return t('compare.diff.cloudTextWords', { kind, words: e.old || e.new });
  return t('compare.diff.cloudText', { kind });
}

/** Makes a cloud on Document B for each entry; the sheet's page of B takes it. */
export function makeClouds(entries: readonly ShownEntry[], sheets: readonly Sheet[]): CloudResult {
  const registry = hostStore.getState().registry;
  if (!registry) return { made: 0, docs: [] };
  const { docs } = documentStore.getState();
  // Rule 9: every B file taking a cloud must allow comments.
  for (const e of entries) {
    const b = sheets[e.sheet]?.b;
    const meta = b ? docs[b.docId]?.meta : undefined;
    if (meta && !allows(securityOf(meta), 'annotate')) return { blocked: meta.name };
  }
  const cap = capability<AnnotationCapability>(registry, 'annotation');
  const tool = cap.getTool('cloud') ?? cap.getTool('polygon');
  const core = registry.getStore().getState().core;
  const touched = new Set<string>();
  let made = 0;
  for (const e of entries) {
    const b = sheets[e.sheet]?.b;
    const page = b ? core.documents[b.docId]?.document?.pages[b.page] : undefined;
    if (!b || !page || !tool) continue;
    const defaults = tool.defaults as Partial<PdfAnnotationObject> & {
      strokeWidth?: number;
      cloudyBorderIntensity?: number;
    };
    const intensity =
      (defaults.cloudyBorderIntensity ?? 0) > 0 ? (defaults.cloudyBorderIntensity ?? 2) : 2;
    const width = defaults.strokeWidth ?? 1;
    const vertices = cloudVertices(e.entry.box, {
      width: page.size.width,
      height: page.size.height,
      rotation: page.rotation,
    });
    const pad = cloudPad(intensity, width);
    const annot = {
      ...defaults,
      type: PdfAnnotationSubtype.POLYGON,
      id: uuidV4(),
      pageIndex: b.page,
      vertices,
      rect: expandRect(rectFromPoints(vertices), pad),
      cloudyBorderIntensity: intensity,
      rectangleDifferences: { left: pad, top: pad, right: pad, bottom: pad },
      contents: cloudText(e.entry),
      flags: defaults.flags ?? ['print'],
      created: new Date(),
    } as PdfAnnotationObject;
    try {
      cap.forDocument(b.docId).createAnnotation(b.page, annot);
      touched.add(b.docId);
      made++;
    } catch (err) {
      recordError('compare.clouds', err);
    }
  }
  return { made, docs: [...touched] };
}
