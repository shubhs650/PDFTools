// Sign Document (M6-13, ADR-021 D-40 b, ADR-022 decision 3, §7.11; beta review
// C1): visual signatures and initials — drawn, typed or an image — placed by
// `@embedpdf/plugin-signature`'s tools as standard annotations: a drawn one is
// an Ink annotation, a typed or uploaded one a Stamp whose appearance holds
// the PNG with a soft mask (rule 6), both with /Subj (Signature). Placement:
// the picture follows the pointer and a click puts it down; from the keyboard,
// Enter puts it in the middle of the current page (rule 12). Optionally
// flattened right after (page content: one more undo step, capability
// modify + annotate). Needs the annotate permission (rule 9). These are not
// certificate-based digital signatures (Rev 1 item 3), and the UI says so.
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfAnnotationObject } from '@embedpdf/models';
import {
  LockModeType,
  type AnnotationCapability,
  type AnnotationTool,
} from '@embedpdf/plugin-annotation';
import {
  deserializeEntries,
  type SerializedSignatureEntry,
  type SignatureCapability,
} from '@embedpdf/plugin-signature';
import { registerCommand } from '../../app/commands/dispatch';
import { recordError } from '../../app/diagnostics';
import { appStore } from '../../app/store/appStore';
import { documentStore, securityOf, selectActive } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import type { StoredEntry } from '../../model/visualSignature';
import { annotationCapability } from '../annotate/selection';
import { applyFlatten, previewFlatten } from '../annotate/flatten/flatten';
import { requestProfile } from '../settings/profile/profileStore';
import { capability, hostStore } from '../view/host';
import { closeSignDialog, openSignDialog } from './signStore';

export type SignatureKind = 'signature' | 'initials';

export const SIGNATURE_TOOLS = ['signatureStamp', 'signatureInk'] as const;
export type SignatureTool = (typeof SIGNATURE_TOOLS)[number];

export const isSignatureTool = (t: string): t is SignatureTool =>
  (SIGNATURE_TOOLS as readonly string[]).includes(t);

/** The subject the plugin gives every placed signature. */
export const SIGNATURE_SUBJECT = 'Signature';

interface Placing {
  docId: string;
  entryId: string;
  /** Not saved on this device: dropped from the plugin when the placement ends. */
  transient: boolean;
  flatten: boolean;
}

let placing: Placing | null = null;
/** Signatures placed with "flatten after placing", waiting for their commit. */
const toFlatten = new Map<string, string>(); // annotation id → document id

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

function signatureCap(): SignatureCapability | null {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<SignatureCapability>(registry, 'signature');
  } catch {
    return null;
  }
}

/** Why the document can't be signed (null: it can; rule 9). */
export function signBlocked(docId: string): 'restricted' | null {
  const d = documentStore.getState().docs[docId];
  return d && allows(securityOf(d.meta), 'annotate') ? null : 'restricted';
}

/** Whether a placed signature may be flattened in this document (modify + annotate). */
export function canFlatten(docId: string): boolean {
  const d = documentStore.getState().docs[docId];
  if (!d) return false;
  const sec = securityOf(d.meta);
  return allows(sec, 'modify') && allows(sec, 'annotate');
}

/** The tool a field is placed with: Ink for a drawing, Stamp for a picture. */
export const toolFor = (entry: StoredEntry, kind: SignatureKind): SignatureTool =>
  (kind === 'initials' ? entry.initials : entry.signature)?.creationType === 'draw'
    ? 'signatureInk'
    : 'signatureStamp';

/**
 * Turns the placement on for `entry`'s signature or initials: the picture
 * follows the pointer until a click (or Enter) puts it down, or Esc.
 */
export function startPlacement(
  docId: string,
  entry: StoredEntry,
  kind: SignatureKind,
  opts: { transient: boolean; flatten: boolean },
): boolean {
  const sig = signatureCap();
  if (!sig || signBlocked(docId)) return false;
  if (kind === 'initials' && !entry.initials) return false;
  endPlacement();
  if (!sig.getEntries().some((e) => e.id === entry.id))
    sig.loadEntries(deserializeEntries([entry as unknown as SerializedSignatureEntry]));
  placing = { docId, entryId: entry.id, transient: opts.transient, flatten: opts.flatten };
  const scope = sig.forDocument(docId);
  if (kind === 'initials') scope.activateInitialsPlacement(entry.id);
  else scope.activateSignaturePlacement(entry.id);
  if (!scope.getActivePlacement()) {
    endPlacement();
    return false;
  }
  // The app's tool follows (the same id is the plugin's interaction mode, DocumentView).
  appStore.getState().setTool(toolFor(entry, kind));
  return true;
}

/** Ends the current placement (a transient entry leaves the plugin). */
function endPlacement(): void {
  const p = placing;
  placing = null;
  if (!p) return;
  if (p.transient) signatureCap()?.removeEntry(p.entryId);
}

/** Enter on the page: the signature in the middle of the current page (rule 12). */
export function placeAtCentre(docId: string): boolean {
  const registry = hostStore.getState().registry;
  const scope = annotationCapability()?.forDocument(docId);
  const tool = scope?.getActiveTool() as AnnotationTool | null | undefined;
  if (!registry || !scope || !tool || !isSignatureTool(tool.id) || !tool.pointerHandler)
    return false;
  const core = registry.getStore().getState().core.documents[docId];
  const pageIndex = documentStore.getState().docs[docId]?.view.page ?? 0;
  const page = core?.document?.pages[pageIndex];
  if (!core || !page) return false;
  const ctx = scope.getState().activeToolContext;
  const handler = tool.pointerHandler.create({
    pageIndex,
    pageSize: page.size,
    pageRotation: (page.rotation + core.rotation) % 4,
    scale: 1,
    services: {},
    onPreview: () => undefined,
    onCommit: (annot: PdfAnnotationObject, c?: unknown) => {
      scope.createAnnotation(pageIndex, annot, c as never);
      scope.setActiveTool(null);
      scope.selectAnnotation(pageIndex, annot.id);
    },
    getTool: () => tool,
    getToolContext: () => ctx,
  } as never) as { onPointerDown?: (pos: { x: number; y: number }, e: unknown) => void };
  const noCapture = { setPointerCapture: () => undefined, releasePointerCapture: () => undefined };
  handler.onPointerDown?.({ x: page.size.width / 2, y: page.size.height / 2 }, noCapture);
  return true;
}

/** Flattens a just-placed signature (its commit has landed; M6-09's flatten). */
async function flattenPlaced(docId: string, id: string): Promise<void> {
  try {
    const plan = previewFlatten(docId, {
      scope: { kind: 'selected', ids: [id] },
      keepReplies: false,
    });
    await applyFlatten(docId, plan);
  } catch (err) {
    recordError('sign.flatten', err);
  }
}

/** Called once the plugin registry is up (DocumentHost); returns the unsubscribe. */
export function installSignTools(registry: PluginRegistry): () => void {
  const offs: (() => void)[] = [];
  try {
    const sig = capability<SignatureCapability>(registry, 'signature');
    // The plugin turns its tool off after a placement: the app's tool follows.
    offs.push(
      sig.onActivePlacementChange(({ documentId, activePlacement }) => {
        if (activePlacement || placing?.docId !== documentId) return;
        endPlacement();
        if (!isSignatureTool(appStore.getState().tool)) return;
        appStore.getState().setTool('select');
        // Unlocked now (DocumentView does it again after rendering), so the
        // plugin's select-after-create, which follows this event, is not refused.
        try {
          capability<AnnotationCapability>(registry, 'annotation')
            .forDocument(documentId)
            .setLocked({ type: LockModeType.None });
        } catch {
          // The document closed meanwhile.
        }
      }),
    );
    const annotation = capability<AnnotationCapability>(registry, 'annotation');
    offs.push(
      annotation.onAnnotationEvent((e) => {
        if (e.type !== 'create' || e.annotation.subject !== SIGNATURE_SUBJECT) return;
        if (!e.committed) {
          if (placing?.flatten && placing.docId === e.documentId)
            toFlatten.set(e.annotation.id, e.documentId);
          return;
        }
        const docId = toFlatten.get(e.annotation.id);
        if (docId === undefined) return;
        toFlatten.delete(e.annotation.id);
        void flattenPlaced(docId, e.annotation.id);
      }),
    );
  } catch {
    // The signature plugin is always registered (plugins.ts).
  }
  // Another tool (Esc, a ribbon button) ends the placement.
  offs.push(
    appStore.subscribe((s, prev) => {
      if (s.tool !== prev.tool && !isSignatureTool(s.tool) && placing) {
        const p = placing;
        endPlacement();
        signatureCap()?.forDocument(p.docId).deactivatePlacement();
      }
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}

export function registerSignCommands(): () => void {
  const off = registerCommand('protect.signDocument', {
    requiresDocument: true,
    requires: 'annotate',
    run: async () => {
      const id = activeId();
      if (!id) return;
      if (isSignatureTool(appStore.getState().tool)) appStore.getState().setTool('select');
      // The reviewer's name is the typed signature's first suggestion (M3-07).
      await requestProfile();
      openSignDialog(id);
    },
  });
  return () => {
    off();
    closeSignDialog();
  };
}
