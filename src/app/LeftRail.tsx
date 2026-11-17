import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, ToggleButton } from '../ui/components';
import { CommandIcon } from '../ui/icons/CommandIcon';
import { commandLabelKey } from './commandLabels';
import { runCommand } from './commands/dispatch';
import { PANES, paneById } from './panes';
import { PaneEdge } from './PaneEdge';
import { PaneSplitter } from './PaneSplitter';
import { appStore, useApp } from './store/appStore';

/** The pane's element id, for its edge arrow's aria-controls (M11-10). */
const PANE_ID = 'left-pane';
const SPLITTER_TEST_ID = 'pane-resizer';

const railButton = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-rail="${id}"] button`);

/**
 * Left rail and pane area (§5, M2-08). The rail holds the pane area toggle and
 * one button per pane (panes.ts); the chosen pane shows beside it with a
 * title and a close button. The edge strip after it (M11-10, D-56) holds the
 * keyboard-operable splitter and the arrow that hides or shows the pane. Esc
 * in a pane returns to its rail button.
 */
export function LeftRail() {
  const { t } = useTranslation();
  const open = useApp((s) => s.leftPaneOpen);
  const paneId = useApp((s) => s.leftPane);
  const width = useApp((s) => s.leftPaneWidth);
  const pane = paneById(paneId);
  const body = useRef<HTMLDivElement>(null);
  /** Set by a rail button: focus moves into the pane it opens. */
  const focusPane = useRef(false);

  // A pane marks where focus goes with `data-pane-focus`; it may render it a
  // little later (content loads), so look for a few frames.
  useEffect(() => {
    if (!open || !focusPane.current) return;
    focusPane.current = false;
    let frames = 30;
    let raf = 0;
    const tryFocus = (): void => {
      const target = body.current?.querySelector<HTMLElement>('[data-pane-focus]');
      if (target) target.focus();
      else if (--frames > 0) raf = requestAnimationFrame(tryFocus);
      else body.current?.querySelector<HTMLElement>('[tabindex="0"], button, input')?.focus();
    };
    tryFocus();
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [open, paneId]);

  // Esc anywhere in the pane returns to its rail button.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      railButton(paneId)?.focus();
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
    };
  }, [open, paneId]);

  const Pane = pane?.component;
  return (
    <aside
      aria-label={t('frame.leftPanes')}
      className={`left-rail${open ? '' : ' left-rail--collapsed'}`}
    >
      <div className="left-rail-icons">
        <ToggleButton
          label={open ? t('frame.hideLeftPanes') : t('frame.showLeftPanes')}
          iconOnly
          icon={<CommandIcon id="view.leftPanes" />}
          pressedIcon={<CommandIcon id="view.leftPanes" pressed />}
          pressed={open}
          onPressedChange={() => {
            appStore.getState().toggleLeftPane();
          }}
        />
        {PANES.map((p) => (
          <span key={p.id} data-rail={p.id} className="left-rail-button">
            <ToggleButton
              label={t(commandLabelKey(p.id))}
              iconOnly
              icon={<CommandIcon id={p.id} />}
              pressedIcon={<CommandIcon id={p.id} pressed />}
              pressed={open && paneId === p.id}
              onPressedChange={() => {
                focusPane.current = !(open && paneId === p.id);
                void runCommand(p.id);
              }}
            />
          </span>
        ))}
      </div>
      {open ? (
        <section
          ref={section}
          id={PANE_ID}
          className="left-pane"
          data-testid="left-pane"
          aria-labelledby="left-pane-title"
          style={{ width }}
        >
          <div className="pane-header">
            <h2 id="left-pane-title" className="pane-title">
              {pane ? t(commandLabelKey(pane.id)) : t('frame.leftPanes')}
            </h2>
            <IconButton
              label={t('frame.closePane')}
              icon={<Dismiss20Regular />}
              size="small"
              tooltip={false}
              onClick={() => {
                appStore.getState().toggleLeftPane();
                railButton(paneId)?.focus();
              }}
            />
          </div>
          <div ref={body} className="left-pane-body">
            {Pane ? <Pane /> : null}
          </div>
        </section>
      ) : null}
      <PaneEdge side="left" open={open} controls={PANE_ID}>
        {open ? (
          <PaneSplitter
            side="left"
            label={t('frame.resizePane')}
            width={width}
            onWidth={(px) => {
              appStore.getState().setLeftPaneWidth(px);
            }}
            testId={SPLITTER_TEST_ID}
          />
        ) : null}
      </PaneEdge>
    </aside>
  );
}
