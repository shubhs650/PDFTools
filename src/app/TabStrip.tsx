import { Add16Regular } from '@fluentui/react-icons/svg/add';
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { Dismiss16Regular } from '@fluentui/react-icons/svg/dismiss';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { requestClose } from '../features/open/openDocument';
import { useOpen } from '../features/open/openStore';
import { format } from '../i18n';
import { DropdownMenu, IconButton, Tooltip } from '../ui/components';
import { runCommand } from './commands/dispatch';
import { shortcutText } from './keys/labels';
import { documentStore, useDocuments } from './store/documentStore';
import { TabCard } from './TabCard';
import { tabCardText } from './tabCardText';

/** A tab that keeps keyboard focus this long shows its hover card (D-50). */
const CARD_FOCUS_DELAY_MS = 800;
/** The pointer resting on a tab this long shows it (the app's tooltip delay). */
const CARD_HOVER_DELAY_MS = 500;

const openFile = (): void => {
  void runCommand('file.open');
};

/**
 * Document tabs (D-01; M11-03 look, hover card and + button, ADR-028 D-50): a tablist
 * with roving focus (arrows, Home, End). Each tab has its own close button next to it
 * (not nested inside the tab, so both stay valid controls). The selected tab is filled
 * with the accent colour; the hover card (after 500 ms over a tab, or 800 ms of
 * keyboard focus) shows page 1, the full name, where the file came from and its
 * facts, which the tab's accessible description also gives. The + button after the
 * last tab, and a double-click on the empty strip, open a file. Files being opened
 * show as busy placeholders; the overflow menu lists every document.
 */
export function TabStrip() {
  const { t } = useTranslation();
  const order = useDocuments((s) => s.order);
  const activeId = useDocuments((s) => s.activeId);
  const docs = useDocuments((s) => s.docs);
  const jobs = useOpen((s) => s.jobs);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // Tab and × are two elements: the hover tint spans both (D-50).
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  // The card renders inside the strip, so it stays in the banner landmark (axe region).
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(focusTimer.current);
    },
    [],
  );
  // A closed document takes its card with it.
  const shownCard = cardId !== null && docs[cardId] ? cardId : null;
  // The selected tab scrolls into view in a long row (from the overflow menu, a new
  // file), clear of the + (the row's scroll-padding).
  useEffect(() => {
    if (activeId)
      refs.current.get(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  const opening =
    jobs.length > 0 ? (
      <div className="tab-opening" role="status">
        {jobs.map((j) => (
          <span key={j.id} className="tab tab--opening">
            <span className="ui-spinner tab-spinner" aria-hidden="true" />
            <span className="tab-name">{t('open.opening', { name: j.name })}</span>
          </span>
        ))}
      </div>
    ) : null;

  // With nothing open the strip collapses (M10-05, review R8); while the first
  // files are opening it shows their busy placeholders.
  if (order.length === 0)
    return opening ? <div className="tab-strip tab-strip--empty">{opening}</div> : null;

  const focusTab = (i: number): void => {
    const id = order[(i + order.length) % order.length];
    if (!id) return;
    documentStore.getState().activate(id);
    refs.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    const moves: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      Home: 0,
      End: order.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    focusTab(to);
  };

  // Keyboard focus shows the card after a pause, so arrowing along the tabs stays
  // quiet. The tooltip's own open-on-focus is stopped (preventDefault skips it).
  const onTabFocus = (e: FocusEvent<HTMLButtonElement>, id: string): void => {
    e.preventDefault();
    clearTimeout(focusTimer.current);
    if (!e.currentTarget.matches(':focus-visible')) return;
    focusTimer.current = setTimeout(() => {
      setCardId(id);
    }, CARD_FOCUS_DELAY_MS);
  };
  const onTabBlur = (): void => {
    clearTimeout(focusTimer.current);
  };

  // A double-click on the empty part of the strip opens a file, as in Chrome.
  const onStripDoubleClick = (e: MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target === e.currentTarget || target.classList.contains('tab-list')) openFile();
  };

  const openKeys = shortcutText('file.open', t);

  return (
    // The double-click is a mouse shortcut only; the + button is the way for everyone.
    <div
      className="tab-strip"
      role="presentation"
      ref={setStripEl}
      onDoubleClick={onStripDoubleClick}
    >
      {/* The tablist holds only tabs (axe aria-required-children); each close
          button follows it in the DOM and is placed after its tab with CSS
          `order` (the tablist itself is `display: contents`). Keyboard: Tab
          from the active tab reaches its close button. */}
      <div className="tab-list">
        <div role="tablist" aria-label={t('frame.tabs')} className="tab-tablist">
          {order.map((id, i) => {
            const d = docs[id];
            if (!d) return null;
            const active = id === activeId;
            const hovered = id === hoverId;
            return (
              <RadixTooltip.Root
                key={id}
                open={shownCard === id}
                delayDuration={CARD_HOVER_DELAY_MS}
                onOpenChange={(open) => {
                  if (open) setCardId(id);
                  else setCardId((cur) => (cur === id ? null : cur));
                }}
              >
                <RadixTooltip.Trigger asChild>
                  <button
                    ref={(el) => {
                      if (el) refs.current.set(id, el);
                      else refs.current.delete(id);
                    }}
                    type="button"
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={active}
                    aria-controls="document-panel"
                    aria-label={d.dirty ? t('frame.dirtyTab', { name: d.meta.name }) : d.meta.name}
                    aria-describedby={`tab-desc-${id}`}
                    tabIndex={active ? 0 : -1}
                    className={`tab-button ui-focusable${active ? ' tab--active' : ''}${
                      hovered ? ' tab--hover' : ''
                    }`}
                    style={{ order: 2 * i }}
                    onClick={() => {
                      documentStore.getState().activate(id);
                    }}
                    onKeyDown={(e) => {
                      onKeyDown(e, i);
                    }}
                    onFocus={(e) => {
                      onTabFocus(e, id);
                    }}
                    onBlur={onTabBlur}
                    onPointerEnter={() => {
                      setHoverId(id);
                    }}
                    onPointerLeave={() => {
                      setHoverId((cur) => (cur === id ? null : cur));
                    }}
                  >
                    {d.dirty ? <span className="tab-dirty" aria-hidden="true" /> : null}
                    <span className="tab-name">{d.meta.name}</span>
                  </button>
                </RadixTooltip.Trigger>
                <RadixTooltip.Portal container={stripEl}>
                  <RadixTooltip.Content
                    className="tab-card"
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                    aria-label={d.meta.name}
                  >
                    <TabCard docId={id} />
                  </RadixTooltip.Content>
                </RadixTooltip.Portal>
              </RadixTooltip.Root>
            );
          })}
        </div>
        {order.map((id, i) => {
          const d = docs[id];
          if (!d) return null;
          const active = id === activeId;
          return (
            <span
              key={id}
              className={`tab-close${active ? ' tab--active' : ''}${
                id === hoverId ? ' tab--hover' : ''
              }`}
              style={{ order: 2 * i + 1 }}
              onPointerEnter={() => {
                setHoverId(id);
              }}
              onPointerLeave={() => {
                setHoverId((cur) => (cur === id ? null : cur));
              }}
            >
              <IconButton
                label={t('frame.closeTab', { name: d.meta.name })}
                icon={<Dismiss16Regular />}
                size="small"
                tooltip={false}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  requestClose(id);
                }}
              />
            </span>
          );
        })}
        {/* After the last tab; it sticks to the row's end when the tabs scroll. */}
        <span className="tab-add" style={{ order: 2 * order.length }}>
          <Tooltip
            content={openKeys ? t('frame.openFileTip', { keys: openKeys }) : t('frame.openFile')}
          >
            <IconButton
              label={t('frame.openFile')}
              icon={<Add16Regular />}
              size="small"
              tooltip={false}
              onClick={openFile}
            />
          </Tooltip>
        </span>
      </div>
      {/* The tabs' accessible descriptions: the hover card's text (D-50). */}
      <div hidden>
        {order.map((id) => {
          const d = docs[id];
          if (!d) return null;
          return (
            <span key={id} id={`tab-desc-${id}`}>
              {tabCardText(d, t, format).description}
            </span>
          );
        })}
      </div>
      {opening}
      <div className="tab-strip-end">
        <DropdownMenu
          align="end"
          trigger={
            <IconButton
              label={t('open.overflow')}
              icon={<ChevronDown16Regular />}
              size="small"
              tooltip={false}
            />
          }
          entries={order.map((id) => ({
            id,
            label: docs[id]?.meta.name ?? id,
            onSelect: () => {
              documentStore.getState().activate(id);
            },
          }))}
        />
      </div>
    </div>
  );
}
