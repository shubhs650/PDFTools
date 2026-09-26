// Following link targets (bookmarks, link annotations; §5, M2-10, M2-Q4).
// Internal destinations jump (recorded for Previous View). External URI
// links never make a request from the app (rule 4): the user confirms the
// full address, and the browser opens it in a new tab. Other files and
// launch actions are not followed.
import { PdfActionType, type PdfDestinationObject, type PdfLinkTarget } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { goToTarget } from './controller';
import { destinationView } from './destination';
import { hostStore } from './host';
import { recordJump } from './viewHistory';

interface LinkState {
  /** An external address waiting for the user's confirmation. */
  pendingUrl: string | null;
}

export const linkStore = createStore<LinkState>()(() => ({ pendingUrl: null }));

export function useLinks<T>(selector: (s: LinkState) => T): T {
  return useStore(linkStore, selector);
}

/** The schemes the browser may be asked to open (anything else is shown, not opened). */
export function openableUrl(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function internalDestination(t: PdfLinkTarget | undefined): PdfDestinationObject | null {
  if (!t) return null;
  if (t.type === 'destination') return t.destination;
  return t.action.type === PdfActionType.Goto ? t.action.destination : null;
}

export function externalUrl(t: PdfLinkTarget | undefined): string | null {
  return t?.type === 'action' && t.action.type === PdfActionType.URI ? t.action.uri : null;
}

function pageHeight(page: number): number {
  const docId = documentStore.getState().activeId;
  const registry = hostStore.getState().registry;
  if (!docId || !registry) return 0;
  return (
    registry.getStore().getState().core.documents[docId]?.document?.pages[page]?.size.height ?? 0
  );
}

/** Follows a bookmark's or link's target in the active document. */
export function followTarget(t: PdfLinkTarget | undefined): void {
  const dest = internalDestination(t);
  if (dest) {
    if (dest.pageIndex < 0) return;
    recordJump();
    goToTarget(destinationView(dest, pageHeight(dest.pageIndex)));
    return;
  }
  const url = externalUrl(t);
  if (url) linkStore.setState({ pendingUrl: url });
}

export function closeLinkDialog(): void {
  linkStore.setState({ pendingUrl: null });
}

/** The user chose "Open in Browser": a user navigation in a new tab, never fetched by the app. */
export function openPendingUrl(): void {
  const url = linkStore.getState().pendingUrl;
  closeLinkDialog();
  if (url && openableUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}
