// The sticky note windows of one page (M7-06): drawn over the rotated page box
// (outside the rotate transform, so they stay upright), each joined to its
// note by a faint leader. The page's pop-ups are read from the file when the
// page first shows with a note on it; windows the file has open open here too.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { useEffect, useMemo } from 'react';
import { securityOf, useDocuments } from '../../../app/store/documentStore';
import { allows } from '../../../model/permissions';
import { objectsOf, useAnnotationMap, type ByUid } from '../comments/commentsStore';
import { buildThread, childrenOf, type StateEntry } from '../comments/thread';
import { NotePopup } from './NotePopup';
import { popupsOf, readPagePopups, useNotePopups } from './notePopupStore';
import { leader, popupToView, rectToView, type PageFrame } from './popupGeometry';

export function NotePopupLayer({
  documentId,
  frame,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
  frame: PageFrame;
}) {
  const byUid = useAnnotationMap(documentId);
  // Only pages with a sticky note ask the Render worker (most pages have none).
  const hasNotes = byUid ? notePagesOf(byUid).has(pageIndex) : false;
  useEffect(() => {
    if (hasNotes) void readPagePopups(documentId, pageIndex);
  }, [documentId, pageIndex, hasNotes]);
  const any = useNotePopups((s) => Object.keys(popupsOf(s, documentId).open).length > 0);
  return any ? <OpenWindows documentId={documentId} pageIndex={pageIndex} frame={frame} /> : null;
}

const notePages = new WeakMap<ByUid, Set<number>>();
/** The pages that have a sticky note (cached per annotation state). */
function notePagesOf(byUid: ByUid): Set<number> {
  let pages = notePages.get(byUid);
  if (!pages) {
    pages = new Set(
      objectsOf(byUid)
        .filter((a) => a.type === PdfAnnotationSubtype.TEXT && !a.inReplyToId)
        .map((a) => a.pageIndex),
    );
    notePages.set(byUid, pages);
  }
  return pages;
}

const latestOf = (states: readonly StateEntry[]): StateEntry | null =>
  states.reduce<StateEntry | null>((a, s) => (a && a.date >= s.date ? a : s), null);

function OpenWindows({
  documentId,
  frame,
  pageIndex,
}: {
  documentId: string;
  pageIndex: number;
  frame: PageFrame;
}) {
  const open = useNotePopups((s) => popupsOf(s, documentId).open);
  const byUid = useAnnotationMap(documentId);
  const canEdit = useDocuments((s) => {
    const meta = s.docs[documentId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const all = useMemo(() => (byUid ? objectsOf(byUid) : []), [byUid]);
  const byId = useMemo(() => new Map(all.map((a) => [a.id, a])), [all]);

  const here = Object.values(open)
    .map((p) => ({ p, note: byId.get(p.noteId) }))
    .filter(
      (x): x is { p: (typeof x)['p']; note: PdfAnnotationObject } =>
        x.note?.pageIndex === pageIndex &&
        x.note.type === PdfAnnotationSubtype.TEXT &&
        !x.note.inReplyToId,
    )
    .sort((a, b) => a.p.z - b.p.z);
  const kids = useMemo(() => childrenOf(all), [all]);
  if (here.length === 0) return null;
  return (
    <div className="note-popup-layer">
      <svg className="note-popup-leaders" aria-hidden="true">
        {here.map(({ p, note }) => {
          const l = leader(rectToView(note.rect, frame), popupToView(p.rect, frame));
          return l ? <line key={note.id} {...l} /> : null;
        })}
      </svg>
      {here.map(({ p, note }) => {
        const thread = buildThread(all, note.id, kids);
        return (
          <NotePopup
            key={note.id}
            docId={documentId}
            note={note}
            popup={p}
            frame={frame}
            replies={thread.replies}
            status={latestOf(thread.states)}
            canEdit={canEdit}
          />
        );
      })}
    </div>
  );
}
