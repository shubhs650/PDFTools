import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { isEditable } from '../../../app/keys/useShortcuts';
import { format, msg, type MessageKey } from '../../../i18n';
import { IDENTITY } from '../../../model/compare/material';
import { presetOf, type Rgb } from '../../../model/compare/overlay';
import { zoomTo } from '../../view/controller';
import { stepZoom } from '../../view/zoom';
import { DocumentView } from '../../view/DocumentView';
import { pairingSession } from '../pairingFlow';
import { FloatingBar } from './FloatingBar';
import { OverlayPage } from './OverlayPage';
import { framePage, useFrame } from './frames';
import { useLayerContent } from './layerCopies';
import type { PainterStats, TileContent } from './painter';
import { drawnStyle, placeOf, updateView, useOverlayView, type Sheet } from './overlayState';

/** Blink flips sides this often while X (or the Blink button) is held. */
const BLINK_MS = 450;

const COLOUR_NAME: Record<string, MessageKey> = {
  '255,0,0': msg('compare.overlay.colourName_red'),
  '0,255,0': msg('compare.overlay.colourName_green'),
  '0,0,255': msg('compare.overlay.colourName_blue'),
  '255,0,255': msg('compare.overlay.colourName_magenta'),
};
const colourName = (c: Rgb): MessageKey =>
  COLOUR_NAME[c.join(',')] ?? msg('compare.overlay.colourName_custom');

/**
 * The overlay window (M12-11, D-59; a live window since M12-12, D-62): the
 * comparison's notes document shown one sheet at a time, with both revisions
 * tinted and multiplied by the Render worker as the page's content, and the
 * floating bar over it. It is a document window like A and B: every comment
 * tool, the Properties pane, the context menus and undo work on the notes,
 * which are never written into Document A or B. Scroll or Hand to pan,
 * Ctrl+wheel or Ctrl+= / Ctrl+- to zoom; hold X to blink between old and new.
 */
export function OverlayWindow({
  id,
  sheet,
  index,
  notesId,
  onFit,
}: {
  id: string;
  sheet: Sheet;
  index: number;
  /** The comparison's notes document (one page per sheet). */
  notesId: string;
  onFit: (mode: 'page' | 'width') => void;
}) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const host = useRef<HTMLDivElement>(null);
  const versionA = useDocuments((s) => (sheet.a ? (s.docs[sheet.a.docId]?.edits ?? 0) : 0));
  const versionB = useDocuments((s) => (sheet.b ? (s.docs[sheet.b.docId]?.edits ?? 0) : 0));
  const nameA = useDocuments((s) => (sheet.a ? (s.docs[sheet.a.docId]?.meta.name ?? '') : ''));
  const nameB = useDocuments((s) => (sheet.b ? (s.docs[sheet.b.docId]?.meta.name ?? '') : ''));
  const scale = useDocuments((s) => s.docs[notesId]?.view.scale ?? 1);
  // The sheet is drawn in Document B's frame; a sheet removed from B in A's own.
  const frame = useFrame(framePage(sheet), sheet.b ? versionB : versionA);

  // Layer switches (D-59, Q24): each side drawn from its layer copy once it is open.
  const layersA = useLayerContent(
    sheet.a?.docId ?? null,
    view.layers[sheet.a?.docId ?? ''],
    versionA,
  );
  const layersB = useLayerContent(
    sheet.b?.docId ?? null,
    view.layers[sheet.b?.docId ?? ''],
    versionB,
  );
  const layersPending = layersA.pending || layersB.pending;

  // The worker works on the sheet in view first (D-66).
  useEffect(() => {
    pairingSession(id)?.focus(sheet.pair);
  }, [id, sheet.pair]);

  const content: TileContent | null = useMemo(() => {
    if (!frame) return null;
    return {
      a: sheet.a
        ? {
            docId: sheet.a.docId,
            pageIndex: sheet.a.page,
            place: sheet.b ? placeOf(view, sheet) : IDENTITY,
            version: versionA,
            ...(layersA.contentId ? { contentId: layersA.contentId } : {}),
          }
        : null,
      b: sheet.b
        ? {
            docId: sheet.b.docId,
            pageIndex: sheet.b.page,
            place: IDENTITY,
            version: versionB,
            ...(layersB.contentId ? { contentId: layersB.contentId } : {}),
          }
        : null,
      style: drawnStyle(view),
      thicken: view.thicken,
      comments: view.comments,
    };
  }, [frame, sheet, view, versionA, versionB, layersA.contentId, layersB.contentId]);
  const contentKey = content && frame ? JSON.stringify([frame, content]) : null;

  // Drawn: every visible tile of exactly this state is on screen (tests and the spinner).
  // Written straight onto the elements: a tile arriving re-renders nothing.
  const onStats = useCallback(
    (s: PainterStats, vp: HTMLElement) => {
      // A layer copy still being built: the drawing is not the one asked for yet.
      const done = s.complete && s.contentKey === contentKey && !layersPending;
      vp.setAttribute('data-complete', done ? 'true' : 'false');
      vp.setAttribute('data-tiles', String(s.drawn));
      vp.setAttribute('data-zoom', String(s.zoom));
      host.current?.setAttribute('data-drawing', done ? 'false' : 'true');
    },
    [contentKey, layersPending],
  );

  const pageContent = useCallback(
    (pageIndex: number, pageScale: number) =>
      pageIndex === index && frame && content ? (
        <OverlayPage
          frame={frame}
          content={content}
          scale={pageScale}
          onStats={onStats}
          waiting={layersPending}
        />
      ) : null,
    // contentKey stands for frame and content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, contentKey, onStats, layersPending],
  );

  // Blink: while held, show old and new alone in turn.
  const blinkTimer = useRef<number | null>(null);
  const startBlink = (): void => {
    if (blinkTimer.current !== null) return;
    updateView(id, (v) => ({ ...v, blink: 'a' }));
    blinkTimer.current = window.setInterval(() => {
      updateView(id, (v) => ({ ...v, blink: v.blink === 'a' ? 'b' : 'a' }));
    }, BLINK_MS);
  };
  const stopBlink = (): void => {
    if (blinkTimer.current !== null) window.clearInterval(blinkTimer.current);
    blinkTimer.current = null;
    updateView(id, (v) => (v.blink === null ? v : { ...v, blink: null }));
  };
  useEffect(() => stopBlink, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!plain || (e.key !== 'x' && e.key !== 'X') || isEditable(e.target as Element)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) startBlink();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'x' || e.key === 'X') stopBlink();
  };

  const label = t('compare.overlay.window', {
    sheet: format.number(index + 1),
    a: nameA || t('compare.side.a'),
    b: nameB || t('compare.side.b'),
    colA: t(colourName(view.style.colA)),
    colB: t(colourName(view.style.colB)),
  });
  const preset = presetOf(view.style.colA, view.style.colB);
  const sheetWindow = useMemo(
    () => ({
      page: index,
      content: pageContent,
      label,
      testId: 'overlay-view',
      data: {
        'data-preset': preset ?? 'custom',
        'data-blink': view.blink ?? '',
      } as Record<`data-${string}`, string>,
    }),
    [index, pageContent, label, preset, view.blink],
  );

  return (
    <div
      ref={host}
      className="overlay-window"
      data-testid="overlay-window"
      data-drawing="true"
      onKeyDownCapture={onKeyDown}
      onKeyUpCapture={onKeyUp}
      onBlurCapture={stopBlink}
    >
      <DocumentView key={notesId} documentId={notesId} sheet={sheetWindow} />
      <span
        className="overlay-drawing ui-spinner"
        role="status"
        aria-label={t('compare.overlay.drawing')}
      />
      <FloatingBar
        id={id}
        sheet={sheet}
        zoomText={format.zoom(scale)}
        onZoom={(dir) => {
          zoomTo(stepZoom(scale, dir), undefined, notesId);
        }}
        onFit={onFit}
        onBlink={(on) => {
          if (on) startBlink();
          else stopBlink();
        }}
      />
    </div>
  );
}
