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
  type PointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { requestClose } from '../features/open/openDocument';
import { useOpen } from '../features/open/openStore';
import { format } from '../i18n';
import { ContextMenu, DropdownMenu, IconButton, Tooltip } from '../ui/components';
import { runCommand } from './commands/dispatch';
import { shortcutText } from './keys/labels';
import { documentStore, useDocuments } from './store/documentStore';
import { TabCard } from './TabCard';
import { tabCardText } from './tabCardText';
import { canRenameFile, tabStateFor } from './tabCommands';
import { isTabCommand, STRIP_MENU, tabMenuEntries } from './tabMenu';
import { beginTabPress, isTabDragging, type TabDragHost } from './tabDragSession';
import { moveTab, onTabNews, setTabAnimator } from './tabMove';

/** A tab that keeps keyboard focus this long shows its hover card (D-50). */
const CARD_FOCUS_DELAY_MS = 800;
/** The pointer resting on a tab this long shows it (the app's tooltip delay). */
const CARD_HOVER_DELAY_MS = 500;

/** After a drag, the click that ends the press is not a click on the tab. */
const SWALLOW_CLICK_MS = 400;

const openFile = (): void => {
  void runCommand('file.open');
};

const parts = (...els: (HTMLElement | undefined)[]): HTMLElement[] =>
  els.filter((el): el is HTMLElement => el !== undefined);

/**
 * Opens the strip's right-click menu on a tab from the keyboard or a touch hold: the
 * same `contextmenu` a right-click sends, placed under the tab's start.
 */
function openMenuOn(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: r.left + Math.min(16, r.width / 2),
      clientY: r.bottom,
    }),
  );
}

/**
 * Document tabs (D-01; M11-03 look, hover card and + button, ADR-028 D-50): a tablist
 * with roving focus (arrows, Home, End). Each tab has its own close button next to it
 * (not nested inside the tab, so both stay valid controls). The selected tab is filled
 * with the accent colour; the hover card (after 500 ms over a tab, or 800 ms of
 * keyboard focus) shows page 1, the full name, where the file came from and its
 * facts, which the tab's accessible description also gives. The + button after the
 * last tab, and a double-click on the empty strip, open a file. Files being opened
 * show as busy placeholders; the overflow menu lists every document.
 *
 * M11-04 (D-50): a tab is dragged along the row to reorder it, Chrome-like (see
 * tabDragSession.ts); Ctrl+Shift+Left/Right moves the focused tab (keymap, scope
 * `tabs`); every move slides into place and is announced. A middle-click closes a tab.
 *
 * M11-05 (D-50): a right-click on a tab (or Shift+F10, the Menu key, a touch hold) opens
 * the tab's menu (tabMenu.ts), whose commands act on that tab; on the empty strip it
 * opens the strip's menu.
 */
export function TabStrip() {
  const { t } = useTranslation();
  const order = useDocuments((s) => s.order);
  const activeId = useDocuments((s) => s.activeId);
  const docs = useDocuments((s) => s.docs);
  const jobs = useOpen((s) => s.jobs);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const closeRefs = useRef(new Map<string, HTMLSpanElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLSpanElement>(null);
  // The tab being dragged (its lift), and the last move said aloud.
  const [dragId, setDragId] = useState<string | null>(null);
  const [moved, setMoved] = useState('');
  const swallowing = useRef(false);
  // Tab and × are two elements: the hover tint spans both (D-50).
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  // The card renders inside the strip, so it stays in the banner landmark (axe region).
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The tab the right-click menu was opened on (null: the empty strip, M11-05).
  const [menuTab, setMenuTab] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(
    () => () => {
      clearTimeout(focusTimer.current);
    },
    [],
  );
  // Moves slide into place (FLIP: measured before and after the commit, then animated
  // from the old place with a transform) and keep keyboard focus on the moved tab.
  useEffect(() => {
    const partsOf = (id: string): HTMLElement[] =>
      parts(refs.current.get(id), closeRefs.current.get(id));
    const offAnimator = setTabAnimator((commit, movedId) => {
      const list = listRef.current;
      const scroll = (): number => list?.scrollLeft ?? 0;
      const ids = documentStore.getState().order;
      const before = new Map<string, number>();
      for (const id of ids) {
        const left = refs.current.get(id)?.getBoundingClientRect().left;
        if (left !== undefined) before.set(id, left + scroll());
        for (const el of partsOf(id)) {
          el.style.transition = 'none';
          el.style.transform = '';
        }
      }
      const focused = document.activeElement;
      flushSync(commit);
      // React moves the nodes; a moved node loses focus.
      if (focused instanceof HTMLElement && focused !== document.activeElement)
        focused.focus({ preventScroll: true });
      refs.current.get(movedId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      for (const id of documentStore.getState().order) {
        const was = before.get(id);
        const now = refs.current.get(id)?.getBoundingClientRect().left;
        if (was === undefined || now === undefined) continue;
        const dx = was - (now + scroll());
        if (Math.abs(dx) >= 0.5)
          for (const el of partsOf(id)) el.style.transform = `translateX(${String(dx)}px)`;
      }
      list?.getBoundingClientRect(); // the old places take effect before the slide starts
      for (const id of ids)
        for (const el of partsOf(id)) {
          el.style.transition = '';
          el.style.transform = '';
        }
    });
    const offMoved = onTabNews((news) => {
      setMoved(
        news.kind === 'moved'
          ? t('frame.tabMoved', { position: news.position, count: news.count })
          : news.kind === 'sorted'
            ? t('frame.tabsSorted')
            : news.kind === 'copied'
              ? t('frame.nameCopied')
              : t('frame.nameCopyFailed'),
      );
    });
    return () => {
      offAnimator();
      offMoved();
    };
  }, [t]);

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

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    // Shift+F10 or the Menu key: the tab's menu, under the tab (M11-05).
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.altKey)) {
      e.preventDefault();
      clearTimeout(focusTimer.current);
      openMenuOn(e.currentTarget);
      return;
    }
    // Ctrl+Shift+arrows move the tab (the keymap's tab.moveLeft/Right), not the focus.
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
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

  const dragHost: TabDragHost = {
    list: () => listRef.current,
    parts: (id) => parts(refs.current.get(id), closeRefs.current.get(id)),
    addButton: () => addRef.current,
    order: () => documentStore.getState().order,
    lift: (id) => {
      clearTimeout(focusTimer.current);
      setCardId(null);
      setDragId(id);
    },
    end: () => {
      setDragId(null);
    },
    drop: (id, to) => {
      moveTab(id, to);
    },
    activate: (id) => {
      documentStore.getState().activate(id);
    },
    swallowClick: () => {
      swallowing.current = true;
      setTimeout(() => {
        swallowing.current = false;
      }, SWALLOW_CLICK_MS);
    },
    menu: (id) => {
      const el = refs.current.get(id);
      if (el) openMenuOn(el);
    },
  };
  const onPress = (e: PointerEvent<HTMLElement>, id: string): void => {
    // The × keeps its own press; the rest of its part of the tab drags the tab.
    if ((e.target as HTMLElement).closest('.ui-button')) return;
    beginTabPress(dragHost, e.nativeEvent, e.currentTarget, id);
  };
  // A middle-click closes the tab, as in Chrome (and never starts the browser's
  // middle-button auto-scroll).
  const onMiddleDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };
  const onMiddleClick = (e: MouseEvent, id: string): void => {
    if (e.button !== 1) return;
    e.preventDefault();
    requestClose(id);
  };

  // A double-click on the empty part of the strip opens a file, as in Chrome.
  const onStripDoubleClick = (e: MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target === e.currentTarget || target.classList.contains('tab-list')) openFile();
  };

  // Right-click (or a long press on the empty strip): the tab's menu on a tab or its ×,
  // the strip's menu anywhere else. The menu's commands act on that tab (args.tab).
  const onStripContextMenu = (e: MouseEvent<HTMLDivElement>): void => {
    const tabEl = (e.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');
    clearTimeout(focusTimer.current);
    setCardId(null);
    setMenuTab(tabEl?.dataset['tabId'] ?? null);
  };
  // A touch held on a tab lifts it for a drag (M11-04); its menu opens when the lifted
  // tab is let go without moving (tabDragSession), never under a lifted tab.
  const onStripPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'touch' && (e.target as HTMLElement).closest('[data-tab-id]'))
      e.preventDefault();
  };
  const menuOn = menuTab !== null && docs[menuTab] ? menuTab : null;
  const menuEntries = menuOn ? tabMenuEntries(canRenameFile(menuOn)) : STRIP_MENU;
  const menuState = (id: string) => (isTabCommand(id) ? tabStateFor(id, menuOn) : undefined);

  const openKeys = shortcutText('file.open', t);

  return (
    <ContextMenu
      label={
        menuOn
          ? t('frame.menu.tabLabel', { name: docs[menuOn]?.meta.name ?? '' })
          : t('frame.menu.stripLabel')
      }
      entries={menuEntries}
      {...(menuOn ? { args: { tab: menuOn } } : {})}
      stateOf={menuState}
      onOpenChange={setMenuOpen}
      onCloseAutoFocus={(e) => {
        // Back to the tab it was opened on (Shift+F10), when that tab is still open.
        const el = menuOn ? refs.current.get(menuOn) : undefined;
        if (!el) return;
        e.preventDefault();
        el.focus({ preventScroll: true });
      }}
    >
      {/* The double-click is a mouse shortcut only; the + button is the way for everyone.
        The right-click menus are reached from a focused tab with Shift+F10 too. */}
      <div
        className="tab-strip"
        role="presentation"
        ref={setStripEl}
        onDoubleClick={onStripDoubleClick}
        onContextMenu={onStripContextMenu}
        onPointerDown={onStripPointerDown}
      >
        {/* The tablist holds only tabs (axe aria-required-children); each close
          button follows it in the DOM and is placed after its tab with CSS
          `order` (the tablist itself is `display: contents`). Keyboard: Tab
          from the active tab reaches its close button. */}
        <div
          className={`tab-list${dragId ? ' tab-list--dragging' : ''}`}
          ref={listRef}
          data-key-scope="tabs"
        >
          <div role="tablist" aria-label={t('frame.tabs')} className="tab-tablist">
            {order.map((id, i) => {
              const d = docs[id];
              if (!d) return null;
              const active = id === activeId;
              // The tab whose menu is open keeps the hover tint, so it is clear which it is for.
              const hovered = id === hoverId || (menuOpen && id === menuTab);
              return (
                <RadixTooltip.Root
                  key={id}
                  open={shownCard === id && dragId === null}
                  delayDuration={CARD_HOVER_DELAY_MS}
                  onOpenChange={(open) => {
                    if (open && !isTabDragging()) setCardId(id);
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
                      data-tab-id={id}
                      aria-selected={active}
                      aria-controls="document-panel"
                      aria-label={
                        d.dirty ? t('frame.dirtyTab', { name: d.meta.name }) : d.meta.name
                      }
                      aria-describedby={`tab-desc-${id}`}
                      tabIndex={active ? 0 : -1}
                      className={`tab-button ui-focusable${active ? ' tab--active' : ''}${
                        hovered ? ' tab--hover' : ''
                      }${id === dragId ? ' tab--dragging' : ''}`}
                      style={{ order: 2 * i }}
                      onClick={() => {
                        if (swallowing.current) return;
                        documentStore.getState().activate(id);
                      }}
                      onPointerDown={(e) => {
                        onPress(e, id);
                      }}
                      onMouseDown={onMiddleDown}
                      onAuxClick={(e) => {
                        onMiddleClick(e, id);
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
              // The ×'s part of the tab drags and middle-click-closes like the tab itself;
              // pointer only (the keyboard has Ctrl+Shift+arrows and the × button).
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <span
                key={id}
                ref={(el) => {
                  if (el) closeRefs.current.set(id, el);
                  else closeRefs.current.delete(id);
                }}
                data-tab-id={id}
                className={`tab-close${active ? ' tab--active' : ''}${
                  id === hoverId || (menuOpen && id === menuTab) ? ' tab--hover' : ''
                }${id === dragId ? ' tab--dragging' : ''}`}
                style={{ order: 2 * i + 1 }}
                onPointerDown={(e) => {
                  onPress(e, id);
                }}
                onMouseDown={onMiddleDown}
                onAuxClick={(e) => {
                  onMiddleClick(e, id);
                }}
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
          <span className="tab-add" ref={addRef} style={{ order: 2 * order.length }}>
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
        {/* Each move, by drag or keys, said once (D-50). A live region without the status
          role, so it is not one more "status" beside the app's own announcements. */}
        <div className="ui-visually-hidden tab-moved" aria-live="polite" aria-atomic="true">
          {moved}
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
    </ContextMenu>
  );
}
