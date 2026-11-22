import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import type { HfBands } from '../../../model/compare/text/headers';
import {
  colourOf,
  marksBySide,
  pageMap,
  type ChangeEntry,
  type MarkColours,
  type MarkStyle,
  type Side,
} from '../../../model/compare/textView';
import { DocumentView } from '../../view/DocumentView';
import { setViewFocus } from '../../view/tileScheduler';
import { useWindowPlace } from '../review/windowPlace';
import { MarkLayer } from './MarkLayer';
import { TextMarks, type MarksContext } from './marksContext';
import { TextLink, fitWidth, textLinks as links, type TextWindowRef } from './textLink';
import { updateTextView, useTextView, type TextRun } from './textFlow';

/**
 * Document A and Document B side by side in continuous scroll (M12-19, D-64,
 * Q32), with the bands across the gap. Both are live document windows: every
 * comment tool, the Properties pane and every context menu act on the window
 * in use, which is the document commands act on (D-62's rules). With sync on
 * (the default) the windows keep the same content in view.
 */
export function TextWindows({
  id,
  run,
  entries,
  visible,
  selected,
}: {
  id: string;
  run: TextRun;
  entries: readonly ChangeEntry[];
  visible: readonly number[];
  selected: number | null;
}) {
  const { t } = useTranslation();
  const view = useTextView(id);
  const { a, b } = run.inputs;
  const link = useMemo(() => {
    const l = links.get(id) ?? new TextLink();
    links.set(id, l);
    return l;
  }, [id]);
  useEffect(
    () => () => {
      link.detach();
      links.delete(id);
    },
    [id, link],
  );

  const hostA = useRef<HTMLDivElement>(null);
  const hostB = useRef<HTMLDivElement>(null);

  // A and B mount one after the other, each as a transition: two document
  // windows in one commit would be a main-thread task over 100 ms (rule 1).
  const [sides, setSides] = useState(0);
  useEffect(() => {
    if (sides >= 2) return;
    const timer = setTimeout(() => {
      startTransition(() => {
        setSides((n) => n + 1);
      });
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [sides]);

  const pageOf = useMemo(() => ({ a: pageMap(a.pages), b: pageMap(b.pages) }), [a.pages, b.pages]);
  const result = run.result;
  useEffect(() => {
    link.setModel(result ? { sync: result.sync, entries, pageOf } : null);
  }, [link, result, entries, pageOf]);

  // Both windows on screen: they follow each other, fitted to their width, from the top.
  const docsKey = `${a.docId}|${b.docId}|${String(sides)}`;
  useEffect(() => {
    if (sides < 2) return;
    const list: TextWindowRef[] = [];
    for (const [side, host] of [
      ['a', hostA.current],
      ['b', hostB.current],
    ] as const)
      if (host) list.push({ side, docId: run.inputs[side].docId, host });
    link.setWindows(list);
    let live = true;
    void Promise.all(list.map((w) => fitWidth(w))).then(() => {
      if (live) link.toTop();
    });
    return () => {
      live = false;
    };
    // docsKey stands for the windows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsKey, link]);

  useEffect(() => {
    link.setEnabled(view.sync);
    if (view.sync) link.drive(link.leaderSide ?? 'b');
  }, [view.sync, link]);

  // Document B is the window in use when the result opens.
  useEffect(() => {
    const s = documentStore.getState();
    if (s.activeTab === id && s.activeId !== a.docId && s.activeId !== b.docId)
      s.focusDocument(b.docId);
  }, [id, a.docId, b.docId]);

  const marks = useMemo(() => marksBySide(entries, pageOf), [entries, pageOf]);
  const ctx: MarksContext = useMemo(
    () => ({
      marks,
      colours: view.colours,
      selected,
      bands: view.bandEdit,
      setBand: (side: Side, edge: keyof HfBands, pt: number) => {
        updateTextView(id, (v) =>
          v.bandEdit
            ? { ...v, bandEdit: { ...v.bandEdit, [side]: { ...v.bandEdit[side], [edge]: pt } } }
            : v,
        );
      },
      sideName: (side: Side) => t(side === 'a' ? 'compare.side.a' : 'compare.side.b'),
    }),
    [marks, view.colours, selected, view.bandEdit, id, t],
  );

  /** The window the user works in: commands act on its document; it leads the other. */
  const aId = a.docId;
  const bId = b.docId;
  const enter = useCallback(
    (side: Side): void => {
      const docId = side === 'a' ? aId : bId;
      if (documentStore.getState().activeId !== docId)
        documentStore.getState().focusDocument(docId);
      setViewFocus(docId, documentStore.getState().docs[docId]?.view.page ?? 0);
      link.lead(side);
    },
    [aId, bId, link],
  );

  return (
    <TextMarks.Provider value={ctx}>
      <div className="text-windows">
        <TextWindow side="a" docId={a.docId} hostRef={hostA} mounted={sides >= 1} onEnter={enter} />
        <Gap
          link={link}
          entries={entries}
          visible={visible}
          selected={selected}
          colours={view.colours}
        />
        <TextWindow side="b" docId={b.docId} hostRef={hostB} mounted={sides >= 2} onEnter={enter} />
      </div>
    </TextMarks.Provider>
  );
}

/**
 * One document's window. Memoised: a new selection or filter redraws the marks
 * (through their context) and the bands, never the document's pages.
 */
const TextWindow = memo(function TextWindow({
  side,
  docId,
  hostRef,
  mounted,
  onEnter,
}: {
  side: Side;
  docId: string;
  hostRef: RefObject<HTMLDivElement | null>;
  mounted: boolean;
  onEnter: (side: Side) => void;
}) {
  const { t } = useTranslation();
  const name = useDocuments((s) => s.docs[docId]?.meta.name ?? '');
  useWindowPlace(mounted ? docId : null);
  const sideName = t(side === 'a' ? 'compare.side.a' : 'compare.side.b');
  const decor = useMemo(
    () =>
      (pageIndex: number, scale: number): ReactNode => (
        <MarkLayer side={side} documentId={docId} pageIndex={pageIndex} scale={scale} />
      ),
    [side, docId],
  );
  const sheet = useMemo(
    () => ({
      label: t('compare.text.windowName', { side: sideName, name }),
      testId: `text-view-${side}`,
      decor,
    }),
    [t, sideName, name, side, decor],
  );
  const enter = (): void => {
    onEnter(side);
  };
  return (
    <div
      ref={hostRef}
      className="review-window text-window"
      data-testid={`text-window-${side}`}
      data-doc-id={docId}
      data-side={side}
      onPointerDownCapture={enter}
      onWheelCapture={enter}
      onFocusCapture={enter}
      onKeyDownCapture={enter}
    >
      <p className="review-window-title" data-side={side}>
        {t('compare.text.window', { side: sideName, name })}
      </p>
      <div className="review-window-view">
        {mounted ? <DocumentView key={docId} documentId={docId} sheet={sheet} /> : null}
      </div>
    </div>
  );
});

/** Band paths per style; the entry in use is drawn on its own, stronger. */
const BAND_STYLES: readonly MarkStyle[] = ['deleted', 'inserted', 'replaced', 'moved', 'figure'];

/**
 * The gap between the windows: a band from each change on A to the same
 * change on B (D-64), drawn straight into the SVG's paths on each frame the
 * windows move (no React render while scrolling).
 */
function Gap({
  link,
  entries,
  visible,
  selected,
  colours,
}: {
  link: TextLink;
  entries: readonly ChangeEntry[];
  visible: readonly number[];
  selected: number | null;
  colours: MarkColours;
}) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const paths = useRef(new Map<string, SVGPathElement>());
  const state = useRef({ entries, visible, selected });
  // A new list, filter or selection: draw again.
  useEffect(() => {
    state.current = { entries, visible, selected };
    link.refresh();
  }, [link, entries, visible, selected, colours]);

  useEffect(() => {
    const draw = (): void => {
      const el = svg.current;
      const placed = link.located();
      const la = link.laid('a');
      const lb = link.laid('b');
      const d = new Map<string, string>();
      if (el && placed && la && lb) {
        const box = el.getBoundingClientRect();
        const w = box.width;
        const h = box.height;
        const va = la.vp.getBoundingClientRect();
        const vb = lb.vp.getBoundingClientRect();
        const ya = (g: number): number =>
          va.top - box.top + la.off + g * la.scale - la.vp.scrollTop;
        const yb = (g: number): number =>
          vb.top - box.top + lb.off + g * lb.scale - lb.vp.scrollTop;
        const { entries: es, visible: vis, selected: sel } = state.current;
        for (const i of vis) {
          const e = es[i];
          const p = placed.places[i];
          if (!e || !p || e.parent !== null) continue;
          const a0 = ya(p.a.top);
          const a1 = Math.max(a0 + 1, ya(p.a.bottom));
          const b0 = yb(p.b.top);
          const b1 = Math.max(b0 + 1, yb(p.b.bottom));
          if ((a1 < 0 && b1 < 0) || (a0 > h && b0 > h)) continue;
          const m = w / 2;
          const seg = `M0,${a0.toFixed(1)}C${m.toFixed(1)},${a0.toFixed(1)} ${m.toFixed(1)},${b0.toFixed(1)} ${w.toFixed(1)},${b0.toFixed(1)}L${w.toFixed(1)},${b1.toFixed(1)}C${m.toFixed(1)},${b1.toFixed(1)} ${m.toFixed(1)},${a1.toFixed(1)} 0,${a1.toFixed(1)}Z`;
          const key = i === sel ? 'selected' : e.style;
          d.set(key, (d.get(key) ?? '') + seg);
        }
      }
      for (const [key, path] of paths.current) path.setAttribute('d', d.get(key) ?? '');
    };
    draw();
    return link.onChange(draw);
  }, [link]);

  const sel = selected === null ? undefined : entries[selected];
  return (
    <svg
      ref={svg}
      className="text-gap"
      role="img"
      aria-label={t('compare.text.gap')}
      data-testid="text-gap"
    >
      {BAND_STYLES.map((s) => (
        <path
          key={s}
          ref={(el) => {
            if (el) paths.current.set(s, el);
            else paths.current.delete(s);
          }}
          data-style={s}
          fill={colourOf(s, colours)}
          fillOpacity={s === 'moved' ? 0.3 : 0.18}
        />
      ))}
      <path
        ref={(el) => {
          if (el) paths.current.set('selected', el);
          else paths.current.delete('selected');
        }}
        data-style="selected"
        fill={sel ? colourOf(sel.style, colours) : 'none'}
        fillOpacity={0.45}
      />
    </svg>
  );
}
