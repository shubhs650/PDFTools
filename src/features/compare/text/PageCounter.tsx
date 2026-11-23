// "Page 12 of 140" in a text comparison window's title (M12-27, D-64,
// ADR-033 decision 6): the page the window shows, read on each frame the
// windows move (a render only when the number changes). A click turns the
// number into a box: type a page and press Enter to go there; the other
// window follows to the matching place by content (the link drives it).
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { currentPage, parsePage } from '../../../model/compare/pageCounter';
import type { Side } from '../../../model/compare/textView';
import { scrollToPlace, type TextLink } from './textLink';

/** Points left above a page gone to, so its top edge shows. */
const GO_MARGIN_PX = 8;

export function PageCounter({ side, docId, link }: { side: Side; docId: string; link: TextLink }) {
  const { t } = useTranslation();
  const count = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 0);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  useEffect(() => {
    const read = (): void => {
      const l = link.laid(side);
      const stack = link.stack(side);
      if (!l || !stack) return;
      const vp = l.vp;
      setPage(
        currentPage(stack, {
          scrollTop: vp.scrollTop,
          clientHeight: vp.clientHeight,
          scrollHeight: vp.scrollHeight,
          off: l.off,
          scale: l.scale,
        }),
      );
    };
    read();
    return link.onChange(read);
  }, [link, side]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const stop = (refocus: boolean): void => {
    setEditing(false);
    setInvalid(false);
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };

  const go = (): void => {
    const to = parsePage(text, count);
    if (to === null) {
      setInvalid(true);
      return;
    }
    const l = link.laid(side);
    const top = link.stack(side)?.tops[to];
    if (l && top !== undefined) {
      // This window leads: its scroll moves the other to the matching place.
      link.lead(side);
      scrollToPlace(l, top - GO_MARGIN_PX / l.scale, 0);
      link.refresh();
    }
    stop(true);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stop(true);
    }
  };

  const shown = format.number(page + 1);
  const total = format.number(count);
  if (count === 0) return null;
  if (editing)
    return (
      <span className="text-page-counter" data-testid={`text-page-${side}`}>
        <span aria-hidden="true">{t('compare.text.pageWord')}</span>
        <input
          ref={input}
          className="text-page-input ui-focusable"
          type="text"
          inputMode="numeric"
          size={Math.max(2, String(count).length)}
          value={text}
          aria-label={t('compare.text.goToPage', { count: total })}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? hintId : undefined}
          data-testid={`text-page-input-${side}`}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setInvalid(false);
          }}
          onKeyDown={onKey}
          onBlur={() => {
            stop(false);
          }}
        />
        <span aria-hidden="true">{t('compare.text.pageOf', { count: total })}</span>
        {invalid ? (
          <span id={hintId} className="ui-visually-hidden" role="alert">
            {t('compare.text.pageInvalid', { count: total })}
          </span>
        ) : null}
      </span>
    );
  return (
    <button
      ref={button}
      type="button"
      className="text-page-counter text-page-button ui-focusable"
      title={t('compare.text.goToPageHint')}
      aria-label={t('compare.text.pageButton', { page: shown, count: total })}
      data-testid={`text-page-${side}`}
      data-page={page + 1}
      onClick={() => {
        setText(String(page + 1));
        setEditing(true);
      }}
    >
      {t('compare.text.page', { page: shown, count: total })}
    </button>
  );
}
