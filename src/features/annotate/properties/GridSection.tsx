// A collapsible section of the Properties pane's property grid (M6-06): a
// heading button (aria-expanded) over two columns, property and value. Which
// sections are collapsed is remembered for the session.
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronRight16Regular } from '@fluentui/react-icons/svg/chevron-right';
import { useId, type ReactNode } from 'react';
import { createStore, useStore } from 'zustand';

const collapsedStore = createStore<{ collapsed: Record<string, boolean> }>()(() => ({
  collapsed: {},
}));

export function GridSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const uid = useId();
  const collapsed = useStore(collapsedStore, (s) => s.collapsed[id] ?? false);
  return (
    <section className="prop-section" aria-labelledby={`${uid}-h`} data-section={id}>
      <h3 className="prop-section-title">
        <button
          type="button"
          id={`${uid}-h`}
          className="prop-section-toggle ui-focusable"
          aria-expanded={!collapsed}
          aria-controls={`${uid}-b`}
          onClick={() => {
            collapsedStore.setState((s) => ({ collapsed: { ...s.collapsed, [id]: !collapsed } }));
          }}
        >
          <span aria-hidden="true" className="prop-section-chevron">
            {collapsed ? <ChevronRight16Regular /> : <ChevronDown16Regular />}
          </span>
          {title}
        </button>
      </h3>
      <div id={`${uid}-b`} className="prop-grid" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
