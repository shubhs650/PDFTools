import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { appStore, useApp } from '../../app/store/appStore';
import type { Rect } from '@embedpdf/models';
import { markAreas, rectFrom } from './markModel';
import { cancelKeyRect, commitKeyRect, markArea, nudgeKeyRect, useKeyRect } from './markTools';
import { annotationCapability } from '../annotate/selection';
import { useMarks, useSelectedIds } from './redactStore';

/** Arrow-key step for the keyboard rectangle (points); Ctrl/⌘ for a fine step. */
const STEP = 10;
const FINE = 1;

const px = (r: Rect, scale: number) => ({
  left: `${String(r.origin.x * scale)}px`,
  top: `${String(r.origin.y * scale)}px`,
  width: `${String(r.size.width * scale)}px`,
  height: `${String(r.size.height * scale)}px`,
});

/**
 * Pending redaction marks on a page (M4-16): each quad outlined; with the
 * Select tools the fill Apply will paint shows on hover, and a click selects
 * the mark (Delete removes it, as any annotation).
 * With Mark Area for Redaction the page takes the pointer: dragging marks a
 * rectangle; the keyboard rectangle (M4-Q10) is shown and focused here.
 */
export function RedactionLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const marks = useMarks(documentId);
  const area = useApp((s) => s.tool === 'redactArea');
  // Marks take the pointer (hover shows the fill, a click selects) with the Select tools.
  const pick = useApp((s) => s.tool === 'select' || s.tool === 'selectObjects');
  const selected = useSelectedIds(documentId);
  const keyRect = useKeyRect((s) =>
    s.docId === documentId && s.page === pageIndex ? s.rect : null,
  );
  const root = useRef<HTMLDivElement>(null);
  const keyEl = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  // The drag's start (points): outside the listeners, so a zoom while dragging
  // (fit width catching up with a pane that opened) keeps the drag going.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onPage = marks.filter((m) => m.pageIndex === pageIndex);

  useEffect(() => {
    if (keyRect) keyEl.current?.focus();
  }, [keyRect !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Native listeners: they run before the page's own pointer handling (text
  // selection) further up, which a React handler could not stop.
  useEffect(() => {
    const el = root.current;
    if (!el || !area) {
      start.current = null;
      return;
    }
    // offsetX/Y: the layer's own (unrotated) coordinates, in CSS pixels.
    const at = (e: PointerEvent) => ({ x: e.offsetX / scale, y: e.offsetY / scale });
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      // The default (focus) is prevented: the document takes focus, so Esc ends the tool.
      el.closest<HTMLElement>('#document-panel')?.focus({ preventScroll: true });
      start.current = at(e);
      setDraft(null);
    };
    const move = (e: PointerEvent) => {
      if (!start.current) return;
      e.stopPropagation();
      setDraft(rectFrom(start.current, at(e)));
    };
    const up = (e: PointerEvent) => {
      if (!start.current) return;
      e.stopPropagation();
      const r = rectFrom(start.current, at(e));
      start.current = null;
      setDraft(null);
      markArea(documentId, pageIndex, r);
    };
    const cancel = () => {
      start.current = null;
      setDraft(null);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [area, scale, documentId, pageIndex]);

  // Picking a mark: native, so the page's own handlers (which would deselect
  // on an empty spot — the plugin has no hit area for /Redact) never see it.
  useEffect(() => {
    const el = root.current;
    if (!el || !pick) return;
    const markOf = (e: Event) =>
      (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-mark]')?.dataset['mark'];
    const down = (e: PointerEvent) => {
      const id = markOf(e);
      if (!id || e.button !== 0) return;
      e.stopPropagation();
      annotationCapability()?.forDocument(documentId).selectAnnotation(pageIndex, id);
    };
    const swallow = (e: Event) => {
      if (markOf(e)) e.stopPropagation();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', swallow);
    el.addEventListener('click', swallow);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', swallow);
      el.removeEventListener('click', swallow);
    };
  }, [pick, documentId, pageIndex, onPage.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: KeyboardEvent) => {
    const step = e.ctrlKey || e.metaKey ? FINE : STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (m) nudgeKeyRect(m[0], m[1], e.shiftKey);
    else if (e.key === 'Enter') commitKeyRect();
    else if (e.key === 'Escape') {
      cancelKeyRect();
      appStore.getState().setTool('select');
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (!onPage.length && !area && !keyRect) return null;
  // Pointer handling on the marks themselves is visual selection only; the
  // keyboard reaches them through Pending Redactions (rule 12).
  return (
    <div
      ref={root}
      className={`redact-layer${area ? ' redact-layer--draw' : ''}`}
      data-testid="redact-layer"
    >
      {onPage.flatMap((m) =>
        markAreas(m).map((r, i) => (
          <div
            key={`${m.id}:${String(i)}`}
            className={`redact-mark${pick ? ' redact-mark--pick' : ''}`}
            data-testid="redact-mark"
            data-mark={m.id}
            data-selected={selected.includes(m.id) || undefined}
            aria-hidden="true"
            style={px(r, scale)}
          />
        )),
      )}
      {draft ? (
        <div
          className="redact-mark redact-mark--draft"
          aria-hidden="true"
          style={px(draft, scale)}
        />
      ) : null}
      {keyRect ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keyboard rectangle (M4-Q10)
        <div
          ref={keyEl}
          role="application"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard rectangle (M4-Q10)
          tabIndex={0}
          className="redact-mark redact-mark--key"
          aria-label={t('redact.keyRect')}
          aria-describedby={`redact-keyrect-help-${String(pageIndex)}`}
          style={px(keyRect, scale)}
          onKeyDown={onKey}
        >
          <span id={`redact-keyrect-help-${String(pageIndex)}`} className="ui-visually-hidden">
            {t('redact.keyRectHelp')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
