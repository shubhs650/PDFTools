// A comparison window's own place (M12-12, S27 change 7). EmbedPDF keeps one
// view state per document, so a document shown in a comparison window and
// in its own tab (never at once: one document area) shares zoom, scroll,
// spread and view rotation. While the window shows it, the document is laid
// out as single pages without view rotation (the link works in each page's
// displayed space); when the window goes, the tab's place is given back the
// next time the tab is shown, as a file's last view is (D-53).
import { useEffect } from 'react';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { documentStore } from '../../../app/store/documentStore';
import { giveBackPlace } from '../../view/lastView';
import { capability, useHost } from '../../view/host';
import { isFacing, toQuarterTurns } from '../../view/viewModes';

/** Lays `docId` out for a comparison window while mounted; gives the tab its place back after. */
export function useWindowPlace(docId: string | null): void {
  const registry = useHost((s) => s.registry);
  useEffect(() => {
    if (!registry || !docId) return;
    const view = documentStore.getState().docs[docId]?.view;
    if (!view) return;
    const stash = { ...view };
    const spread = capability<SpreadCapability>(registry, 'spread').forDocument(docId);
    const rotate = capability<RotateCapability>(registry, 'rotate').forDocument(docId);
    try {
      if (isFacing(stash.mode)) spread.setSpreadMode(SpreadMode.None);
      if (stash.rotation !== 0) rotate.setRotation(0);
    } catch {
      // Not loaded in the engine yet: nothing to lay out differently.
    }
    return () => {
      const s = documentStore.getState();
      if (!s.docs[docId]) return;
      try {
        if (isFacing(stash.mode)) spread.setSpreadMode(SpreadMode.Odd);
        if (stash.rotation !== 0) rotate.setRotation(toQuarterTurns(stash.rotation));
      } catch {
        // Closed meanwhile.
      }
      // Only a document with a tab of its own has a place to give back.
      if (s.order.includes(docId)) giveBackPlace(docId, stash);
    };
  }, [registry, docId]);
}
