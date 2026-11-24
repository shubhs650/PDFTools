import { ChevronDown12Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronRight12Regular } from '@fluentui/react-icons/svg/chevron-right';
import { useId, type ReactNode } from 'react';
import { sectionOpen, setSection, updateLayout, useLayout, type SectionKey } from './layoutStore';

/**
 * A section of the overlay's left pane that folds to a one-line summary (M12-25, ADR-033,
 * D-62): its heading is a button (aria-expanded) and the comparison remembers whether it is
 * open. `forceOpen` keeps it open while its work is in progress (picking points, drawing).
 */
export function FoldSection({
  id,
  section,
  title,
  summary,
  help,
  defaultOpen = false,
  forceOpen = false,
  className,
  testId,
  helpTopic,
  children,
}: {
  /** The comparison. */
  id: string;
  section: SectionKey;
  title: string;
  /** What the section holds, in one line, shown while it is folded. */
  summary: string;
  /** A "?" button after the title. */
  help?: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  className: string;
  testId?: string;
  helpTopic?: string;
  children: ReactNode;
}) {
  const layout = useLayout(id);
  const headingId = useId();
  const bodyId = useId();
  const open = forceOpen || sectionOpen(layout, section, defaultOpen);
  return (
    <section
      className={`${className} cmp-fold`}
      aria-labelledby={headingId}
      data-testid={testId}
      data-help-topic={helpTopic}
      data-open={open ? 'true' : 'false'}
    >
      <div className="pane-title-row">
        <h3 id={headingId} className="overlay-side-title cmp-fold-title">
          <button
            type="button"
            className="cmp-fold-button ui-focusable"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            disabled={forceOpen}
            data-testid={`fold-${section}`}
            onClick={() => {
              updateLayout(id, (l) => setSection(l, section, !open));
            }}
          >
            <span className="cmp-fold-chevron" aria-hidden="true">
              {open ? <ChevronDown12Regular /> : <ChevronRight12Regular />}
            </span>
            <span>{title}</span>
          </button>
        </h3>
        {help}
      </div>
      {open ? (
        <div id={bodyId} className="cmp-fold-body">
          {children}
        </div>
      ) : (
        <p className="cmp-fold-summary" data-testid={`fold-summary-${section}`}>
          {summary}
        </p>
      )}
    </section>
  );
}
