import type { Rect } from '@embedpdf/models';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { appStore, useApp } from '../../app/store/appStore';
import {
  cancelKeyRect,
  commitKeyRect,
  copySnapshot,
  nudgeKeyRect,
  pageSize,
  useSnapshot,
} from './snapshot';
import { snapshotRect } from './snapshotModel';

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
 * The Snapshot tool on a page (M6-09): while it is on, the page takes the
 * pointer and a drag copies the rectangle's picture; the keyboard rectangle
 * (rule 12, like Mark Area for Redaction's) is shown and focused here.
 */
export function SnapshotLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const on = useApp((s) => s.tool === 'snapshot');
  const key = useSnapshot((s) =>
    s.key?.docId === documentId && s.key.page === pageIndex ? s.key.rect : null,
  );
  const root = useRef<HTMLDivElement>(null);
  const keyEl = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Rect | null>(null);

  useEffect(() => {
    if (key) keyEl.current?.focus();
  }, [key !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Native listeners: they run before the page's own pointer handling (text
  // selection) further up, which a React handler could not stop.
  useEffect(() => {
    const el = root.current;
    if (!el || !on) return;
    let start: { x: number; y: number } | null = null;
    // offsetX/Y: the layer's own (unrotated) coordinates, in CSS pixels.
    const at = (e: PointerEvent) => ({ x: e.offsetX / scale, y: e.offsetY / scale });
    const rectTo = (e: PointerEvent): Rect | null => {
      if (!start) return null;
      const { width, height } = pageSize(documentId, pageIndex);
      return snapshotRect(start, at(e), width, height);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      // The document takes focus, so Esc ends the tool.
      el.closest<HTMLElement>('#document-panel')?.focus({ preventScroll: true });
      cancelKeyRect();
      start = at(e);
      setDraft(null);
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      e.stopPropagation();
      setDraft(rectTo(e));
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      e.stopPropagation();
      const r = rectTo(e);
      start = null;
      setDraft(null);
      // In the pointerup itself: the clipboard needs the user's activation.
      if (r) copySnapshot(documentId, pageIndex, r);
    };
    const cancel = () => {
      start = null;
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
  }, [on, scale, documentId, pageIndex]);

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

  if (!on && !key) return null;
  return (
    <div
      ref={root}
      className={`snapshot-layer${on ? ' snapshot-layer--draw' : ''}`}
      data-testid="snapshot-layer"
    >
      {draft ? (
        <div
          className="snapshot-rect"
          data-testid="snapshot-draft"
          aria-hidden="true"
          style={px(draft, scale)}
        />
      ) : null}
      {key ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keyboard rectangle (M4-Q10)
        <div
          ref={keyEl}
          role="application"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard rectangle (M4-Q10)
          tabIndex={0}
          className="snapshot-rect snapshot-rect--key"
          aria-label={t('snapshot.keyRect')}
          aria-describedby={`snapshot-keyrect-help-${String(pageIndex)}`}
          style={px(key, scale)}
          onKeyDown={onKey}
        >
          <span id={`snapshot-keyrect-help-${String(pageIndex)}`} className="ui-visually-hidden">
            {t('snapshot.keyRectHelp')}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** What the last snapshot did: shown for a few seconds and said by screen readers. */
export function SnapshotToast() {
  const message = useSnapshot((s) => s.message);
  return (
    <div className="snapshot-toast-region" role="status" aria-live="polite">
      {message ? (
        <p
          key={message.seq}
          className={`snapshot-toast${message.ok ? '' : ' snapshot-toast--error'}`}
          data-testid="snapshot-toast"
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
